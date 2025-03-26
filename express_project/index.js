const express = require('express');
const app = express();
const sqlite3 = require('sqlite3').verbose();
const jwt = require('jsonwebtoken');
const md5 = require('md5');
const bcrypt = require('bcrypt');
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(express.json());
const PORT = 3000;

const cors = require('cors');
app.use(cors());

// SQLite DB 연결
const db = new sqlite3.Database('./database.db');

// 테이블 준비 함수
function initDB() {
  db.serialize(() => {
    // 사용자 테이블
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT
    )`);

    // 게시글 테이블
    db.run(`CREATE TABLE IF NOT EXISTS articles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT,
        content TEXT,
        user_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )`);

    // 댓글 테이블
    db.run(`CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        content TEXT,
        article_id INTEGER,
        user_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (article_id) REFERENCES articles(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
    )`);

    // admin 계정 생성
    const adminPassword = bcrypt.hashSync('admin1234', 10);
    db.run(`INSERT OR IGNORE INTO users (username, password) VALUES (?, ?)`, ['admin', adminPassword], function(err) {
        if (err) {
            console.error('admin 계정 생성 실패:', err);
        } else {
            console.log('admin 계정이 생성되었습니다.');
        }
    });

    // 기본 공지사항 추가
    db.get('SELECT id FROM users WHERE username = ?', ['admin'], (err, row) => {
        if (err) {
            console.error('admin 사용자 조회 실패:', err);
            return;
        }
        if (row) {
            db.get('SELECT COUNT(*) as count FROM articles', (err, result) => {
                if (err) {
                    console.error('게시글 수 조회 실패:', err);
                    return;
                }
                if (result.count === 0) {
                    db.run(`INSERT INTO articles (title, content, user_id) VALUES (?, ?, ?)`,
                        ['공지사항', '게시판이 개설되었습니다. 많은 이용 부탁드립니다.', row.id],
                        function(err) {
                            if (err) {
                                console.error('공지사항 추가 실패:', err);
                            } else {
                                console.log('기본 공지가 추가되었습니다.');
                            }
                        }
                    );
                } else {
                    console.log('기본 공지가 이미 존재합니다.');
                }
            });
        }
    });
  });
}

// Socket.IO 연결 처리
io.on('connection', (socket) => {
    console.log('클라이언트가 연결되었습니다.');

    socket.on('disconnect', () => {
        console.log('클라이언트 연결이 종료되었습니다.');
    });
});

// 서버 실행
http.listen(PORT, () => {
  console.log(`서버가 http://localhost:${PORT}에서 실행중임`);
  initDB();
});

// JWT 토큰 발급 함수
function generateToken(user) {
  return jwt.sign({ id: user.id, username: user.username }, 'SECRET_KEY', { expiresIn: '1h' });
}

// POST: 회원가입
app.post('/register', (req, res) => {
  const { username, password } = req.body;

  const hashedPassword = md5(password); // 비밀번호 MD5 해시화

  db.run(`INSERT INTO users (username, password) VALUES (?, ?)`, [username, hashedPassword], function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ message: "회원가입 성공!" });
  });
});

// POST: 로그인
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const hashedPassword = md5(password); // 비밀번호 MD5 해시화

  db.get(`SELECT * FROM users WHERE username = ? AND password = ?`, [username, hashedPassword], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (!row) {
      return res.status(401).json({ message: "잘못된 아이디 또는 비밀번호" });
    }

    // JWT 토큰 발급
    const token = generateToken(row);

    // 로그인 성공 시 사용자 정보를 포함한 응답
    res.json({
      message: "로그인 성공!",
      token,
      user: { id: row.id, username: row.username }  // 여기서 사용자 정보도 반환
    });
  });
});

// 인증된 요청 (JWT 검증)
app.get('/profile', (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "토큰 없음" });

  jwt.verify(token, 'SECRET_KEY', (err, decoded) => {
    if (err) return res.status(403).json({ message: "유효하지 않은 토큰" });
    res.json({ message: `환영합니다, ${decoded.username}님!` });
  });
});

// GET: 글 목록 조회
app.get('/articles', (req, res) => {
    db.all(`
        SELECT a.*, u.username 
        FROM articles a 
        LEFT JOIN users u ON a.user_id = u.id 
        ORDER BY a.created_at DESC
    `, [], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        // username이 null인 경우 '시스템'으로 대체
        const articles = rows.map(row => ({
            ...row,
            username: row.username || '시스템'
        }));
        res.json(articles);
    });
});

// POST: 글 추가
app.post('/articles', (req, res) => {
  const { title, content } = req.body;
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "인증이 필요합니다." });
  }

  if (!title || !content) {
    return res.status(400).json({ error: "제목과 내용을 입력하세요." });
  }

  jwt.verify(token, 'SECRET_KEY', (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: "유효하지 않은 토큰입니다." });
    }

    db.run(`INSERT INTO articles (title, content, user_id) VALUES (?, ?, ?)`, 
      [title, content, decoded.id],
      function(err) {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        const newArticle = {
          id: this.lastID,
          title,
          content,
          user_id: decoded.id,
          username: decoded.username,
          created_at: new Date().toISOString()
        };
        // 모든 클라이언트에게 새 게시글 알림
        io.emit('newArticle', newArticle);
        res.json(newArticle);
      }
    );
  });
});

// PUT: 글 수정
app.put('/articles/:id', (req, res) => {
  const id = req.params.id;
  const { title, content } = req.body;
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "인증이 필요합니다." });
  }

  if (!title || !content) {
    return res.status(400).json({ error: "제목과 내용을 입력하세요." });
  }

  jwt.verify(token, 'SECRET_KEY', (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: "유효하지 않은 토큰입니다." });
    }

    db.get('SELECT user_id FROM articles WHERE id = ?', [id], (err, row) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (!row) {
        return res.status(404).json({ error: "게시글을 찾을 수 없습니다." });
      }
      if (row.user_id !== decoded.id) {
        return res.status(403).json({ error: "게시글 수정 권한이 없습니다." });
      }

      db.run(`UPDATE articles SET title = ?, content = ? WHERE id = ?`, [title, content, id], function(err) {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        const updatedArticle = {
          id: parseInt(id),
          title,
          content,
          user_id: decoded.id,
          username: decoded.username
        };
        // 모든 클라이언트에게 수정된 게시글 알림
        io.emit('articleUpdated', updatedArticle);
        res.json(updatedArticle);
      });
    });
  });
});

// DELETE: 글 삭제
app.delete('/articles/:id', (req, res) => {
  const id = req.params.id;
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "인증이 필요합니다." });
  }

  jwt.verify(token, 'SECRET_KEY', (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: "유효하지 않은 토큰입니다." });
    }

    db.get('SELECT user_id FROM articles WHERE id = ?', [id], (err, row) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      if (!row) {
        return res.status(404).json({ error: "게시글을 찾을 수 없습니다." });
      }
      if (row.user_id !== decoded.id) {
        return res.status(403).json({ error: "게시글 삭제 권한이 없습니다." });
      }

      db.run(`DELETE FROM articles WHERE id = ?`, [id], function(err) {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        // 모든 클라이언트에게 삭제된 게시글 ID 알림
        io.emit('articleDeleted', id);
        res.json({ message: "삭제 완료!" });
      });
    });
  });
});

// POST: 댓글 추가
app.post('/articles/:id/comments', (req, res) => {
  const articleId = req.params.id;
  const { content } = req.body;
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "인증이 필요합니다." });
  }

  if (!content) {
    return res.status(400).json({ error: "댓글 내용을 입력하세요." });
  }

  jwt.verify(token, 'SECRET_KEY', (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: "유효하지 않은 토큰입니다." });
    }

    db.run(`INSERT INTO comments (content, article_id, user_id) VALUES (?, ?, ?)`,
      [content, articleId, decoded.id],
      function(err) {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        const newComment = {
          id: this.lastID,
          content,
          article_id: articleId,
          user_id: decoded.id,
          username: decoded.username,
          created_at: new Date().toISOString()
        };
        // 모든 클라이언트에게 새 댓글 알림
        io.emit('newComment', newComment);
        res.json(newComment);
      }
    );
  });
});

// GET: 특정 게시글에 달린 댓글 조회
app.get('/articles/:id/comments', (req, res) => {
  const articleId = req.params.id;

  db.all(
    `SELECT comments.*, users.username 
     FROM comments 
     LEFT JOIN users ON comments.user_id = users.id
     WHERE article_id = ? 
     ORDER BY comments.created_at DESC`,
    [articleId],
    (err, rows) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      // username이 null인 경우 '시스템' 으로 표시
      rows = rows.map(row => ({
        ...row,
        username: row.username || '시스템'
      }));
      res.json(rows);
    }
  );
});






