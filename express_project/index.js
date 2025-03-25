const express = require('express');
const app = express();
const sqlite3 = require('sqlite3').verbose();
const jwt = require('jsonwebtoken');
const md5 = require('md5');
app.use(express.json());
const PORT = 3000;

const cors = require('cors');
app.use(cors());

// SQLite DB 연결
const db = new sqlite3.Database('./database.db');

// 테이블 준비 함수
function initDB() {
  db.run(`
    CREATE TABLE IF NOT EXISTS articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT,
      content TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) {
      console.error("테이블 생성 에러:", err);
    } else {
      console.log("테이블 준비 완료(articles)");
      checkForDefaultNotice();  // 기본 공지 체크 및 추가
    }
  });

  db.run(`
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      article_id INTEGER,
      content TEXT,
      user_id INTEGER,  // 댓글 작성자 ID 추가
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (article_id) REFERENCES articles(id),
      FOREIGN KEY (user_id) REFERENCES users(id)  // users 테이블과 연결
    )
  `, (err) => {
    if (err) {
      console.error("댓글 테이블 생성 에러:", err);
    } else {
      console.log("댓글 테이블 준비 완료(comments)");
    }
  });

  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password TEXT
    )
  `, (err) => {
    if (err) {
      console.error("사용자 테이블 생성 에러:", err);
    } else {
      console.log("사용자 테이블 준비 완료(users)");
    }
  });
}

// 기본 공지 추가 함수
function checkForDefaultNotice() {
  db.get('SELECT * FROM articles WHERE title = ? AND content = ?', ['공지', '봉일천을 자극하지마라..'], (err, row) => {
    if (err) {
      console.error("공지 체크 오류:", err);
    } else if (!row) {
      // 기본 공지가 없다면 추가
      db.run('INSERT INTO articles (title, content) VALUES (?, ?)', ['공지', '봉일천을 자극하지마라..'], function(err) {
        if (err) {
          console.error("기본 공지 추가 오류:", err);
        } else {
          console.log("기본 공지가 추가되었습니다.");
        }
      });
    } else {
      console.log("기본 공지가 이미 존재합니다.");
    }
  });
}

initDB();

// 서버 실행
app.listen(PORT, () => {
  console.log(`서버가 http://localhost:${PORT}에서 실행중임`);
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

// GET: 모든 게시글 조회
app.get('/articles', (req, res) => {
  db.all("SELECT * FROM articles ORDER BY created_at DESC", [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);  // 모든 게시글 반환
  });
});

// POST: 글 추가
app.post('/articles', (req, res) => {
  const { title, content } = req.body;

  db.run(`INSERT INTO articles (title, content) VALUES (?, ?)`, [title, content], function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ id: this.lastID, title, content });
  });
});

// PUT: 글 수정
app.put('/articles/:id', (req, res) => {
  const id = req.params.id;
  const { title, content } = req.body;

  db.run(`UPDATE articles SET title = ?, content = ? WHERE id = ?`, [title, content, id], function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: "수정할 데이터가 없습니다." });
    }
    res.json({ id, title, content });
  });
});

// DELETE: 글 삭제
app.delete('/articles/:id', (req, res) => {
  const id = req.params.id;

  db.run(`DELETE FROM articles WHERE id = ?`, [id], function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: "삭제할 데이터가 없습니다." });
    }
    res.json({ message: "삭제 완료!" });
  });
});

// POST: 댓글 추가
app.post('/articles/:id/comments', (req, res) => {
  const articleId = req.params.id;
  const { content } = req.body;

  if (!content) {
    return res.status(400).json({ error: "댓글 내용을 입력하세요." });
  }

  db.run(
    `INSERT INTO comments (article_id, content) VALUES (?, ?)`,  // user_id 삭제
    [articleId, content],
    function (err) {
      if (err) {
        return res.status(500).json({ error: err.message });
      }
      res.json({ id: this.lastID, article_id: articleId, content });  // 내용만 반환
    }
  );
});




// GET: 특정 게시글에 달린 댓글 조회
app.get('/articles/:id/comments', (req, res) => {
  const articleId = req.params.id;

  db.all(`SELECT content FROM comments WHERE article_id = ? ORDER BY created_at DESC`, [articleId], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);  // 댓글 내용만 반환
  });
});






