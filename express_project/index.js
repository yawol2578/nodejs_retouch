const expr = require('express');
const app = expr();
const sqlite3 = require('sqlite3').verbose();
app.use(expr.json());
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
    }
  });

  // 댓글 테이블 추가
  db.run(`
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      article_id INTEGER,
      content TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (article_id) REFERENCES articles(id)
    )
  `, (err) => {
    if (err) {
      console.error("댓글 테이블 생성 에러:", err);
    } else {
      console.log("댓글 테이블 준비 완료(comments)");
    }
  });
}

initDB();

// 서버 실행
app.listen(PORT, () => {
  console.log(`서버가 http://localhost:${PORT}에서 실행중임`);
});

// 날짜 포맷 함수 (ISO 8601 형식으로 반환)
function formatDate(date) {
  const d = new Date(date);
  return d.toISOString(); // ISO 8601 형식으로 변환
}

// GET: 모든 게시글 조회
app.get('/articles', (req, res) => {
  db.all("SELECT * FROM articles ORDER BY created_at DESC", [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    // 날짜 포맷 적용
    const formattedArticles = rows.map(article => ({
      ...article,
      created_at: formatDate(article.created_at)
    }));
    res.json(formattedArticles);  // 모든 게시글 반환
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
      return res.status(500).json({error: err.message});
    }
    if (this.changes === 0) {
      return res.status(404).json({error: "수정할 데이터가 없습니다."});
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

// 댓글 추가
app.post('/articles/:id/comments', (req, res) => {
  const articleId = req.params.id;
  const { content } = req.body;

  db.run(`INSERT INTO comments (article_id, content) VALUES (?, ?)`, [articleId, content], function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json({ id: this.lastID, articleId, content });
  });
});

// 댓글 수정
app.put('/articles/:articleId/comments/:id', (req, res) => {
  const articleId = req.params.articleId;
  const commentId = req.params.id;
  const { content } = req.body;

  db.run(`UPDATE comments SET content = ? WHERE id = ? AND article_id = ?`, [content, commentId, articleId], function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: "수정할 댓글이 없습니다." });
    }
    res.json({ id: commentId, articleId, content });
  });
});

// 댓글 삭제
app.delete('/articles/:articleId/comments/:id', (req, res) => {
  const articleId = req.params.articleId;
  const commentId = req.params.id;

  db.run(`DELETE FROM comments WHERE id = ? AND article_id = ?`, [commentId, articleId], function(err) {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    if (this.changes === 0) {
      return res.status(404).json({ error: "삭제할 댓글이 없습니다." });
    }
    res.json({ message: "댓글 삭제 완료!" });
  });
});

// 게시글에 대한 댓글 조회
app.get('/articles/:id/comments', (req, res) => {
  const articleId = req.params.id;

  db.all(`SELECT * FROM comments WHERE article_id = ? ORDER BY created_at DESC`, [articleId], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    // 댓글 목록 날짜 포맷 적용
    const formattedComments = rows.map(comment => ({
      ...comment,
      created_at: formatDate(comment.created_at)
    }));
    res.json(formattedComments); // 댓글 목록 반환
  });
});

// DB 닫기
process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error(err.message);
    } else {
      console.log('데이터베이스 연결 종료');
    }
    process.exit(0);
  });
});
