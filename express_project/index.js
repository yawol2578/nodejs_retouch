const express = require('express');
const app = express();
const sqlite3 = require('sqlite3').verbose();
const jwt = require('jsonwebtoken');
const md5 = require('md5');
const bcrypt = require('bcrypt');
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: {
        origin: process.env.CORS_ORIGIN || "*",
        methods: ["GET", "POST"]
    }
});
require('dotenv').config();

app.use(express.json());
const PORT = process.env.PORT || 3000;

const cors = require('cors');
app.use(cors());

// SQLite DB 연결
const db = new sqlite3.Database(process.env.DB_PATH || 'database.db', (err) => {
    if (err) {
        console.error('데이터베이스 연결 실패:', err);
    } else {
        console.log('데이터베이스 연결 성공');
    }
});

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

    // 좋아요 테이블
    db.run(`CREATE TABLE IF NOT EXISTS likes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        article_id INTEGER,
        comment_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (article_id) REFERENCES articles(id),
        FOREIGN KEY (comment_id) REFERENCES comments(id),
        UNIQUE(user_id, article_id, comment_id)
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
  return jwt.sign(
    { id: user.id, username: user.username },
    process.env.JWT_SECRET || 'SECRET_KEY',
    { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
  );
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
  if (!token) {
    return res.status(401).json({ error: "인증이 필요합니다." });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'SECRET_KEY', (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: "유효하지 않은 토큰입니다." });
    }
    res.json(decoded);
  });
});

// 게시글 목록 조회 API
app.get('/articles', (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  let userId = null;

  if (token) {
    jwt.verify(token, process.env.JWT_SECRET || 'SECRET_KEY', (err, decoded) => {
      if (!err) {
        userId = decoded.id;
      }
    });
  }

  db.all(`
    SELECT a.*, u.username,
           CASE WHEN l.user_id IS NOT NULL THEN 1 ELSE 0 END as liked
    FROM articles a
    LEFT JOIN users u ON a.user_id = u.id
    LEFT JOIN likes l ON a.id = l.article_id AND l.user_id = ?
    ORDER BY a.created_at DESC
  `, [userId], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows.map(row => ({
      ...row,
      username: row.username || '시스템',
      created_at: row.created_at || new Date().toISOString(),
      liked: Boolean(row.liked)
    })));
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

// 댓글 작성
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

  jwt.verify(token, process.env.JWT_SECRET || 'SECRET_KEY', (err, decoded) => {
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
          created_at: new Date().toISOString(),
          like_count: 0,
          liked: false
        };
        // 모든 클라이언트에게 새 댓글 알림
        io.emit('newComment', newComment);
        res.json(newComment);
      }
    );
  });
});

// 댓글 조회 API
app.get('/articles/:id/comments', (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  let userId = null;

  if (token) {
    jwt.verify(token, process.env.JWT_SECRET || 'SECRET_KEY', (err, decoded) => {
      if (!err) {
        userId = decoded.id;
      }
    });
  }

  db.all(`
    SELECT c.*, u.username,
           CASE WHEN l.user_id IS NOT NULL THEN 1 ELSE 0 END as liked
    FROM comments c
    LEFT JOIN users u ON c.user_id = u.id
    LEFT JOIN likes l ON c.id = l.comment_id AND l.user_id = ?
    WHERE c.article_id = ?
    ORDER BY c.created_at DESC
  `, [userId, req.params.id], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows.map(row => ({
      ...row,
      username: row.username || '시스템',
      created_at: row.created_at || new Date().toISOString(),
      liked: Boolean(row.liked)
    })));
  });
});

// 좋아요 토글 API
app.post('/likes/toggle', (req, res) => {
  const { article_id, comment_id } = req.body;
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "인증이 필요합니다." });
  }

  if (!article_id && !comment_id) {
    return res.status(400).json({ error: "게시글 또는 댓글 ID가 필요합니다." });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'SECRET_KEY', (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: "유효하지 않은 토큰입니다." });
    }

    // 좋아요 상태 확인
    db.get(
      `SELECT * FROM likes WHERE user_id = ? AND article_id = ? AND comment_id = ?`,
      [decoded.id, article_id || null, comment_id || null],
      (err, row) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }

        if (row) {
          // 이미 좋아요를 누른 상태면 좋아요 취소
          db.run(
            `DELETE FROM likes WHERE user_id = ? AND article_id = ? AND comment_id = ?`,
            [decoded.id, article_id || null, comment_id || null],
            function(err) {
              if (err) {
                return res.status(500).json({ error: err.message });
              }
              // 좋아요 수 업데이트
              updateLikeCount(article_id, comment_id);
              io.emit('likeToggled', { article_id, comment_id, liked: false });
              res.json({ liked: false });
            }
          );
        } else {
          // 좋아요를 누르지 않은 상태면 좋아요 추가
          db.run(
            `INSERT INTO likes (user_id, article_id, comment_id) VALUES (?, ?, ?)`,
            [decoded.id, article_id || null, comment_id || null],
            function(err) {
              if (err) {
                // UNIQUE 제약조건 위반 시 에러 처리
                if (err.message.includes('UNIQUE constraint failed')) {
                  return res.status(400).json({ error: "이미 좋아요를 누른 게시글/댓글입니다." });
                }
                return res.status(500).json({ error: err.message });
              }
              // 좋아요 수 업데이트
              updateLikeCount(article_id, comment_id);
              io.emit('likeToggled', { article_id, comment_id, liked: true });
              res.json({ liked: true });
            }
          );
        }
      }
    );
  });
});

// 좋아요 수 업데이트 함수
function updateLikeCount(article_id, comment_id) {
  if (article_id) {
    db.get(
      `SELECT COUNT(*) as count FROM likes WHERE article_id = ?`,
      [article_id],
      (err, row) => {
        if (!err) {
          io.emit('likeCountUpdated', { article_id, count: row.count });
        }
      }
    );
  } else if (comment_id) {
    db.get(
      `SELECT COUNT(*) as count FROM likes WHERE comment_id = ?`,
      [comment_id],
      (err, row) => {
        if (!err) {
          io.emit('likeCountUpdated', { comment_id, count: row.count });
        }
      }
    );
  }
}

// 좋아요 수 조회 API
app.get('/likes/count', (req, res) => {
  const { article_id, comment_id } = req.query;

  if (!article_id && !comment_id) {
    return res.status(400).json({ error: "게시글 또는 댓글 ID가 필요합니다." });
  }

  db.get(
    `SELECT COUNT(*) as count FROM likes WHERE article_id = ? AND comment_id = ?`,
    [article_id || null, comment_id || null],
    (err, row) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json({ count: row.count });
    }
  );
});

// 사용자의 좋아요 상태 조회 API
app.get('/likes/status', (req, res) => {
  const { article_id, comment_id } = req.query;
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "인증이 필요합니다." });
  }

  if (!article_id && !comment_id) {
    return res.status(400).json({ error: "게시글 또는 댓글 ID가 필요합니다." });
  }

  jwt.verify(token, process.env.JWT_SECRET || 'SECRET_KEY', (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: "유효하지 않은 토큰입니다." });
    }

    db.get(
      `SELECT * FROM likes WHERE user_id = ? AND article_id = ? AND comment_id = ?`,
      [decoded.id, article_id || null, comment_id || null],
      (err, row) => {
        if (err) {
          return res.status(500).json({ error: err.message });
        }
        res.json({ liked: !!row });
      }
    );
  });
});






