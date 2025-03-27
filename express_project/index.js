const express = require('express');
const app = express();
const sqlite3 = require('sqlite3').verbose();
const jwt = require('jsonwebtoken');
const md5 = require('md5');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
require('dotenv').config();

app.use(express.json());
const PORT = process.env.PORT || 3001;

const cors = require('cors');
app.use(cors({
    origin: "*",  // 모든 도메인에서의 접근 허용
    credentials: true
}));

// 정적 파일 제공
app.use(express.static('public'));

// 데이터베이스 연결
const db = new sqlite3.Database('database.db', (err) => {
    if (err) {
        console.error('데이터베이스 연결 실패:', err);
        return;
    }
    console.log('데이터베이스 연결 성공');
    initDB(); // 데이터베이스 연결 성공 후 초기화 함수 호출
});

// DB 초기화
function initDB() {
    db.serialize(() => {
        // 사용자 테이블
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // 게시글 테이블
        db.run(`CREATE TABLE IF NOT EXISTS articles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            content TEXT NOT NULL,
            user_id INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )`);

        // 댓글 테이블
        db.run(`CREATE TABLE IF NOT EXISTS comments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            content TEXT NOT NULL,
            article_id INTEGER,
            user_id INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (article_id) REFERENCES articles(id),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )`);

        // admin 계정 생성
        db.get('SELECT * FROM users WHERE username = ?', ['admin'], (err, row) => {
            if (err) {
                console.error('admin 계정 확인 실패:', err);
                return;
            }
            if (!row) {
                const hashedPassword = crypto.createHash('md5').update('admin123').digest('hex');
                db.run('INSERT INTO users (username, password) VALUES (?, ?)', 
                    ['admin', hashedPassword], 
                    (err) => {
                        if (err && !err.message.includes('UNIQUE constraint failed')) {
                            console.error('admin 계정 생성 실패:', err);
                        } else {
                            console.log('admin 계정이 생성되었습니다.');
                        }
                    });
            }
        });

        // 기본 공지사항 추가
        db.get('SELECT * FROM articles WHERE title = ?', ['공지사항'], (err, row) => {
            if (err) {
                console.error('공지사항 확인 실패:', err);
                return;
            }
            if (!row) {
                db.get('SELECT id FROM users WHERE username = ?', ['admin'], (err, adminRow) => {
                    if (err) {
                        console.error('admin 사용자 조회 실패:', err);
                        return;
                    }
                    if (adminRow) {
                        db.run('INSERT INTO articles (title, content, user_id) VALUES (?, ?, ?)',
                            ['공지사항', '환영합니다! 게시판을 이용해 주셔서 감사합니다.', adminRow.id],
                            (err) => {
                                if (err) {
                                    console.error('기본 공지 추가 실패:', err);
                                } else {
                                    console.log('기본 공지가 추가되었습니다.');
                                }
                            });
                    }
                });
            }
        });
    });
}

// JWT 토큰 생성
function generateToken(user) {
    return jwt.sign(
        { id: user.id, username: user.username },
        process.env.JWT_SECRET || 'SECRET_KEY',
        { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
    );
}

// 로그인 API
app.post('/login', (req, res) => {
    const { username, password } = req.body;
    const hashedPassword = md5(password);

    db.get('SELECT * FROM users WHERE username = ? AND password = ?', 
        [username, hashedPassword], 
        (err, row) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            if (row) {
                const token = generateToken(row);
                res.json({ token, user: { id: row.id, username: row.username } });
            } else {
                res.status(401).json({ error: '아이디 또는 비밀번호가 잘못되었습니다.' });
            }
        }
    );
});

// 회원가입 API
app.post('/register', (req, res) => {
    const { username, password } = req.body;
    const hashedPassword = md5(password);

    db.run('INSERT INTO users (username, password) VALUES (?, ?)', 
        [username, hashedPassword], 
        function(err) {
            if (err) {
                if (err.message.includes('UNIQUE constraint failed')) {
                    return res.status(400).json({ error: '이미 사용 중인 아이디입니다.' });
                }
                return res.status(500).json({ error: err.message });
            }
            res.json({ message: '회원가입이 완료되었습니다.' });
        }
    );
});

// 프로필 조회 API
app.get('/profile', (req, res) => {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) {
        return res.status(401).json({ error: "인증이 필요합니다." });
    }

    jwt.verify(token, process.env.JWT_SECRET || 'SECRET_KEY', (err, decoded) => {
        if (err) {
            return res.status(403).json({ error: "유효하지 않은 토큰입니다." });
        }

        db.get('SELECT id, username FROM users WHERE id = ?', [decoded.id], (err, row) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            if (row) {
                res.json(row);
            } else {
                res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
            }
        });
    });
});

// 게시글 목록 조회 API
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
        res.json(rows.map(row => ({
            ...row,
            username: row.username || '시스템',
            created_at: row.created_at || new Date().toISOString()
        })));
    });
});

// 게시글 작성 API
app.post('/articles', (req, res) => {
    const { title, content } = req.body;
    const token = req.headers.authorization?.split(" ")[1];

    if (!token) {
        return res.status(401).json({ error: "인증이 필요합니다." });
    }

    jwt.verify(token, process.env.JWT_SECRET || 'SECRET_KEY', (err, decoded) => {
        if (err) {
            return res.status(403).json({ error: "유효하지 않은 토큰입니다." });
        }

        db.run('INSERT INTO articles (title, content, user_id) VALUES (?, ?, ?)', 
            [title, content, decoded.id], 
            function(err) {
                if (err) {
                    return res.status(500).json({ error: err.message });
                }
                const article = {
                    id: this.lastID,
                    title,
                    content,
                    user_id: decoded.id,
                    username: decoded.username,
                    created_at: new Date().toISOString()
                };
                res.json(article);
            }
        );
    });
});

// 게시글 수정 API
app.put('/articles/:id', (req, res) => {
    const { title, content } = req.body;
    const token = req.headers.authorization?.split(" ")[1];

    if (!token) {
        return res.status(401).json({ error: "인증이 필요합니다." });
    }

    jwt.verify(token, process.env.JWT_SECRET || 'SECRET_KEY', (err, decoded) => {
        if (err) {
            return res.status(403).json({ error: "유효하지 않은 토큰입니다." });
        }

        db.get('SELECT * FROM articles WHERE id = ?', [req.params.id], (err, article) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            if (!article) {
                return res.status(404).json({ error: "게시글을 찾을 수 없습니다." });
            }
            if (article.user_id !== decoded.id) {
                return res.status(403).json({ error: "수정 권한이 없습니다." });
            }

            db.run('UPDATE articles SET title = ?, content = ? WHERE id = ?', 
                [title, content, req.params.id], 
                (err) => {
                    if (err) {
                        return res.status(500).json({ error: err.message });
                    }
                    const updatedArticle = {
                        ...article,
                        title,
                        content,
                        username: decoded.username
                    };
                    res.json(updatedArticle);
                }
            );
        });
    });
});

// 게시글 삭제 API
app.delete('/articles/:id', (req, res) => {
    const token = req.headers.authorization?.split(" ")[1];

    if (!token) {
        return res.status(401).json({ error: "인증이 필요합니다." });
    }

    jwt.verify(token, process.env.JWT_SECRET || 'SECRET_KEY', (err, decoded) => {
        if (err) {
            return res.status(403).json({ error: "유효하지 않은 토큰입니다." });
        }

        db.get('SELECT * FROM articles WHERE id = ?', [req.params.id], (err, article) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            if (!article) {
                return res.status(404).json({ error: "게시글을 찾을 수 없습니다." });
            }
            if (article.user_id !== decoded.id) {
                return res.status(403).json({ error: "삭제 권한이 없습니다." });
            }

            db.run('DELETE FROM articles WHERE id = ?', [req.params.id], (err) => {
                if (err) {
                    return res.status(500).json({ error: err.message });
                }
                res.json({ message: "게시글이 삭제되었습니다." });
            });
        });
    });
});

// 댓글 조회 API
app.get('/articles/:id/comments', (req, res) => {
    db.all(`
        SELECT c.*, u.username
        FROM comments c
        LEFT JOIN users u ON c.user_id = u.id
        WHERE c.article_id = ?
        ORDER BY c.created_at DESC
    `, [req.params.id], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json(rows.map(row => ({
            ...row,
            username: row.username || '시스템',
            created_at: row.created_at || new Date().toISOString()
        })));
    });
});

// 댓글 작성 API
app.post('/articles/:id/comments', (req, res) => {
    const { content } = req.body;
    const token = req.headers.authorization?.split(" ")[1];

    if (!token) {
        return res.status(401).json({ error: "인증이 필요합니다." });
    }

    jwt.verify(token, process.env.JWT_SECRET || 'SECRET_KEY', (err, decoded) => {
        if (err) {
            return res.status(403).json({ error: "유효하지 않은 토큰입니다." });
        }

        db.run('INSERT INTO comments (content, article_id, user_id) VALUES (?, ?, ?)', 
            [content, req.params.id, decoded.id], 
            function(err) {
                if (err) {
                    return res.status(500).json({ error: err.message });
                }
                const comment = {
                    id: this.lastID,
                    content,
                    article_id: req.params.id,
                    user_id: decoded.id,
                    username: decoded.username,
                    created_at: new Date().toISOString()
                };
                res.json(comment);
            }
        );
    });
});

// 댓글 삭제 API
app.delete('/articles/:articleId/comments/:commentId', (req, res) => {
    const { articleId, commentId } = req.params;
    const token = req.headers.authorization?.split(" ")[1];

    if (!token) {
        return res.status(401).json({ error: "인증이 필요합니다." });
    }

    jwt.verify(token, process.env.JWT_SECRET || 'SECRET_KEY', (err, decoded) => {
        if (err) {
            return res.status(403).json({ error: "유효하지 않은 토큰입니다." });
        }

        db.get('SELECT * FROM comments WHERE id = ? AND article_id = ?', [commentId, articleId], (err, comment) => {
            if (err) {
                return res.status(500).json({ error: '댓글 삭제 중 오류가 발생했습니다.' });
            }
            if (!comment) {
                return res.status(404).json({ error: '댓글을 찾을 수 없습니다.' });
            }
            if (comment.user_id !== decoded.id) {
                return res.status(403).json({ error: '댓글을 삭제할 권한이 없습니다.' });
            }

            db.run('DELETE FROM comments WHERE id = ?', [commentId], function(err) {
                if (err) {
                    return res.status(500).json({ error: '댓글 삭제 중 오류가 발생했습니다.' });
                }
                res.json({ message: '댓글이 삭제되었습니다.' });
            });
        });
    });
});

// 서버 실행
app.listen(PORT, '0.0.0.0', () => {
    console.log(`서버가 http://0.0.0.0:${PORT}에서 실행중임`);
    initDB();
});






