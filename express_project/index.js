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
      insertDefaultArticles();  // 공지사항 추가
    }
  });
}

// 기본 공지사항 추가 함수
function insertDefaultArticles() {
  const defaultNotices = [
    { title: "봉일천에 가지마라", content: "진짜 가지 마라. 이유는 묻지 마라." }
  ];

  // 공지사항이 이미 있는지 체크
  defaultNotices.forEach(({ title, content }) => {
    db.get(`SELECT * FROM articles WHERE title = ?`, [title], (err, row) => {
      if (err) {
        console.log("공지사항 조회 중 오류 발생:", err.message);
      } else if (!row) { // 공지사항이 없으면 추가
        db.run(`INSERT INTO articles (title, content) VALUES (?, ?)`, [title, content], function(err) {
          if (err) {
            console.log("기본 공지사항 추가 실패:", err.message);
          } else {
            console.log(`공지사항 추가 완료: ${title}`);
          }
        });
      } else {
        console.log(`공지사항 이미 존재: ${title}`);
      }
    });
  });
}

initDB();

// 서버 실행
app.listen(PORT, () => {
    console.log(`서버가 http://localhost:${PORT}에서 실행중임`);
});

// GET: 모든 게시글 조회
app.get('/articles', (req, res) => {
  db.all("SELECT * FROM articles ORDER BY created_at DESC", [], (err, rows) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }
    res.json(rows);  // 모든 게시글(공지 포함) 반환
  });
});

// POST: 글 추가
app.post('/articles', (req, res) => {
  const { title, content } = req.body;
  db.run(`INSERT INTO articles (title, content) VALUES (?, ?)`, [title, content], function(err) {
    if (err) {
      return res.status(500).json({error: err.message});
    }
    res.json({id: this.lastID, title, content});
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
    res.json({id, title, content});
  });
});

// DELETE: 글 삭제 (공지사항은 삭제할 수 없음)
app.delete('/articles/:id', (req, res) => {
  const id = req.params.id;

  // 공지사항을 삭제할 수 없도록 하기
  db.get(`SELECT * FROM articles WHERE id = ?`, [id], (err, row) => {
    if (err) {
      return res.status(500).json({ error: err.message });
    }

    if (!row) {
      return res.status(404).json({ error: "삭제할 데이터가 없습니다." });
    }

    // 삭제할 글이 공지사항이면 삭제하지 않음
    const noticeTitles = ["봉일천에 가지마라"]; // 공지사항 제목 배열
    if (noticeTitles.includes(row.title)) {
      return res.status(400).json({ error: "공지사항은 삭제할 수 없습니다." });
    }

    // 공지사항이 아니면 삭제 처리
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
