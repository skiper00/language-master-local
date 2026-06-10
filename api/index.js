process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const express = require('express');
const cors = require('cors');
const path = require('path');
const dbPromise = require('../db'); // Подключаем SQLite
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const fileUpload = require('express-fileupload');
const fs = require('fs');

const app = express();
const SECRET = 'super-secret-key-change-it-in-production';

app.use(cors());
app.use(express.json());
app.use(fileUpload());

if (!process.env.VERCEL) {
    app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
}
app.use(express.static(path.join(__dirname, '../public')));

if (!process.env.VERCEL) {
    const uploadDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir);
    }
}

const initDb = async () => {
    const db = await dbPromise;
    await db.exec(`
        CREATE TABLE IF NOT EXISTS user_progress (
            user_id INTEGER,
            lesson_id INTEGER,
            score INTEGER,
            completed_at DATETIME,
            PRIMARY KEY (user_id, lesson_id)
        );
    `);
    await db.exec(`
        CREATE TABLE IF NOT EXISTS manually_completed (
            user_id INTEGER,
            lesson_id INTEGER,
            PRIMARY KEY (user_id, lesson_id)
        );
    `);
};
initDb().catch(console.error);

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
    const [salt, hash] = stored.split(':');
    const verifyHash = crypto.scryptSync(password, salt, 64).toString('hex');
    return hash === verifyHash;
}

async function checkAchievements(userId) {
    const db = await dbPromise;
    const newBadges = [];

    const userStats = await db.get(`
        SELECT 
            (SELECT COUNT(*) FROM user_progress WHERE user_id = ?) as lessons,
            streak
        FROM users WHERE user_id = ?
    `, [userId, userId]);

    if (!userStats) return newBadges;

    const rules = [
        { id: 1, condition: userStats.lessons >= 1 },
        { id: 2, condition: userStats.lessons >= 5 },
        { id: 3, condition: userStats.streak >= 3 }
    ];

    for (let rule of rules) {
        if (rule.condition) {
            const res = await db.run(
                'INSERT OR IGNORE INTO user_achievements (user_id, ach_id) VALUES (?, ?)',
                [userId, rule.id]
            );

            if (res.changes > 0) {
                await db.run(`
                    UPDATE users 
                    SET xp_points = xp_points + (SELECT xp_reward FROM achievements WHERE ach_id = ?) 
                    WHERE user_id = ?
                `, [rule.id, userId]);
                newBadges.push(rule.id);
            }
        }
    }
    return newBadges;
}

// ==========================================
// МАРШРУТЫ API
// ==========================================

app.get('/api', (req, res) => {
    res.json({ status: 'Server is running on Vercel!' });
});

app.get('/api/teacher/stats/activity/:teacherId', async (req, res) => {
    try {
        const db = await dbPromise;
        const teacherId = req.params.teacherId;
        const classId = req.query.classId;

        let sql = `
            SELECT strftime('%Y-%m-%d', up.completed_at) as dateStr, COUNT(*) as count
            FROM user_progress up
            JOIN class_members cm ON up.user_id = cm.student_id
            JOIN classes c ON cm.class_id = c.class_id
            WHERE c.teacher_id = ? 
            AND up.completed_at >= datetime('now', '-7 days')
        `;

        const params = [teacherId];

        if (classId && classId !== 'ALL') {
            sql += ` AND cm.class_id = ?`;
            params.push(classId);
        }

        sql += ` GROUP BY dateStr ORDER BY dateStr ASC`;

        const rows = await db.all(sql, params);
        res.json(rows);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/teacher/remove-student', async (req, res) => {
    try {
        const db = await dbPromise;
        const { classId, studentId } = req.body;
        await db.run(
            'DELETE FROM class_members WHERE class_id = ? AND student_id = ?',
            [classId, studentId]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/teacher/student-details/:studentId', async (req, res) => {
    try {
        const db = await dbPromise;
        const studentId = req.params.studentId;

        const users = await db.all('SELECT name, email, avatar, streak, created_at FROM users WHERE user_id = ?', [studentId]);
        if (!users.length) return res.status(404).json({ error: 'User not found' });

        const history = await db.all(`
            SELECT l.title_ru, strftime('%d.%m.%Y %H:%M', up.completed_at) as date
            FROM user_progress up
            JOIN lessons l ON up.lesson_id = l.lesson_id
            WHERE up.user_id = ?
            ORDER BY up.completed_at DESC
            LIMIT 10
        `, [studentId]);

        res.json({ user: users[0], history });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/auth/register', async (req, res) => {
    const { name, email, password, role } = req.body;
    try {
        const db = await dbPromise;
        const hash = hashPassword(password);
        const userRole = role === 'teacher' ? 'teacher' : 'student';

        await db.run(
            'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
            [name, email, hash, userRole]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(400).json({ error: 'Ошибка регистрации или Email занят' });
    }
});

app.post('/api/teacher/remove-class', async (req, res) => {
    try {
        const db = await dbPromise;
        const { classId } = req.body;
        await db.run('DELETE FROM class_members WHERE class_id = ?', [classId]);
        await db.run('DELETE FROM classes WHERE class_id = ?', [classId]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const db = await dbPromise;
        const users = await db.all('SELECT * FROM users WHERE email = ?', [email]);
        if (!users.length || !verifyPassword(password, users[0].password_hash)) {
            return res.status(401).json({ error: 'Неверный email или пароль' });
        }

        const user = users[0];

        const token = jwt.sign(
            { id: user.user_id, role: user.role },
            SECRET,
            { expiresIn: '24h' }
        );

        res.json({
            token,
            user: { id: user.user_id, name: user.name, role: user.role, avatar: user.avatar }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/teacher/dashboard/:id', async (req, res) => {
    try {
        const db = await dbPromise;
        const classes = await db.all('SELECT * FROM classes WHERE teacher_id = ?', [req.params.id]);

        for (let cls of classes) {
            const students = await db.all(`
                SELECT u.user_id, u.name, u.avatar,
                (SELECT COUNT(*) FROM manually_completed mc WHERE mc.user_id = u.user_id) as lessons_done,
                (
                    SELECT AVG((up.score * 1.0 / NULLIF((SELECT COUNT(*) FROM lesson_tasks lt WHERE lt.lesson_id = up.lesson_id), 0)) * 5)
                    FROM user_progress up 
                    WHERE up.user_id = u.user_id AND up.score > 0
                ) as average_grade
                FROM users u
                JOIN class_members cm ON u.user_id = cm.student_id
                WHERE cm.class_id = ?
            `, [cls.class_id]);
            cls.students = students;
        }
        res.json(classes);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/teacher/classes', async (req, res) => {
    try {
        const db = await dbPromise;
        await db.run('INSERT INTO classes (teacher_id, class_name) VALUES (?, ?)', [req.body.teacherId, req.body.name]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/teacher/add-student', async (req, res) => {
    console.log('➡️ [API] Add Student Request:', req.body);

    try {
        const db = await dbPromise;
        const classId = parseInt(req.body.classId, 10);
        const studentId = parseInt(req.body.studentId, 10);

        if (isNaN(classId) || isNaN(studentId)) {
            return res.status(400).json({ error: 'Некорректные данные: ID должны быть числами!' });
        }

        const st = await db.all(
            "SELECT user_id FROM users WHERE user_id = ? AND role = 'student'",
            [studentId]
        );

        if (!st.length) {
            return res.status(404).json({ error: 'Ученик не найден в базе данных (или роль не student)' });
        }

        const result = await db.run(
            'INSERT OR IGNORE INTO class_members (class_id, student_id) VALUES (?, ?)',
            [classId, studentId]
        );

        console.log('✅ [API] Успешно:', result);
        res.json({ success: true });

    } catch (err) {
        console.error('🔥 [API] DB ERROR:', err);
        res.status(500).json({ error: 'Ошибка БД: ' + err.message });
    }
});

app.post('/api/chat', async (req, res) => {
    const { history } = req.body;
    const AUTH_KEY = 'MDE5ZDYyY2YtMmUwZC03OTU0LTk4MDktNTJkMjNhNGM3OWRiOmRlZjE5MTc4LTJlMzYtNGRhNy1hOWZmLWViNDRhMmU3ODJlMQ==';

    try {
        const rqUID = crypto.randomUUID();

        const tokenResponse = await fetch('https://ngw.devices.sberbank.ru:9443/api/v2/oauth', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json',
                'Authorization': `Basic ${AUTH_KEY}`,
                'RqUID': rqUID
            },
            body: new URLSearchParams({
                'scope': 'GIGACHAT_API_PERS'
            })
        });

        const tokenData = await tokenResponse.json();
        const accessToken = tokenData.access_token;

        if (!accessToken) throw new Error("Не удалось получить токен доступа GigaChat");

        const messages = history.map(msg => ({
            role: msg.role === 'user' ? 'user' : 'assistant',
            content: msg.text
        }));

        messages.unshift({
            role: "system",
            content: `Ты — умный ИИ-помощник в приложении LangMaster. Отвечай на языке пользователя.`
        });

        const chatResponse = await fetch('https://gigachat.devices.sberbank.ru/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Authorization': `Bearer ${accessToken}`
            },
            body: JSON.stringify({
                model: "GigaChat",
                messages: messages,
                temperature: 0.7,
                max_tokens: 1000
            })
        });

        const chatData = await chatResponse.json();

        if (chatData.error) throw new Error(chatData.error.message);

        const replyText = chatData.choices[0].message.content;
        res.json({ reply: replyText });

    } catch (err) {
        console.error("GigaChat Error:", err);
        res.status(500).json({ error: "Ошибка GigaChat: " + err.message });
    }
});

app.get('/api/word-of-day', async (req, res) => {
    try {
        const db = await dbPromise;
        const ids = await db.all('SELECT word_id FROM words');

        if (ids.length === 0) return res.json(null);

        const now = new Date();
        const seed = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();

        const index = (seed * 997) % ids.length;
        const targetId = ids[index].word_id;

        const rows = await db.all('SELECT * FROM words WHERE word_id = ?', [targetId]);

        res.json(rows[0] || null);

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/user', async (req, res) => {
    const { userId, password } = req.body;

    try {
        const db = await dbPromise;
        const users = await db.all('SELECT * FROM users WHERE user_id = ?', [userId]);
        if (!users.length) return res.status(404).json({ error: 'Пользователь не найден' });

        const user = users[0];
        if (!verifyPassword(password, user.password_hash)) {
            return res.status(403).json({ error: 'Неверный пароль!' });
        }

        await db.run('DELETE FROM user_progress WHERE user_id = ?', [userId]);
        await db.run('DELETE FROM user_achievements WHERE user_id = ?', [userId]);
        await db.run('DELETE FROM class_members WHERE student_id = ?', [userId]);

        if (user.role === 'teacher') {
            const classes = await db.all('SELECT class_id FROM classes WHERE teacher_id = ?', [userId]);
            const classIds = classes.map(c => c.class_id);

            if (classIds.length > 0) {
                const placeholders = classIds.map(() => '?').join(',');
                await db.run(`DELETE FROM class_members WHERE class_id IN (${placeholders})`, classIds);
                await db.run('DELETE FROM classes WHERE teacher_id = ?', [userId]);
            }
        }

        await db.run('DELETE FROM users WHERE user_id = ?', [userId]);

        res.json({ success: true });

    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Ошибка при удалении: ' + err.message });
    }
});

app.delete('/api/progress', async (req, res) => {
    try {
        const db = await dbPromise;
        await db.run('DELETE FROM user_progress WHERE user_id = ? AND lesson_id = ?', [req.body.userId, req.body.lessonId]);
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/progress/:userId', async (req, res) => {
    try {
        const db = await dbPromise;
        // Теперь ищем только ручные отметки!
        const rows = await db.all('SELECT lesson_id FROM manually_completed WHERE user_id = ?', [req.params.userId]);
        res.json(rows.map(r => r.lesson_id));
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/manual-progress', async (req, res) => {
    try {
        const db = await dbPromise;
        const { userId, lessonId, isCompleted } = req.body;
        if (isCompleted) {
            await db.run('INSERT OR IGNORE INTO manually_completed (user_id, lesson_id) VALUES (?, ?)', [userId, lessonId]);
        } else {
            await db.run('DELETE FROM manually_completed WHERE user_id = ? AND lesson_id = ?', [userId, lessonId]);
        }
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/lessons', async (req, res) => {
    const lang = req.query.lang || 'en';
    try {
        const db = await dbPromise;
        const rows = await db.all(`
            SELECT lesson_id, level_code, title_ru, title_en, description_ru
            FROM lessons
            WHERE lang_code = ?
            ORDER BY level_code, lesson_id`, [lang]);
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/lessons/:id', async (req, res) => {
    try {
        const db = await dbPromise;
        const lessonId = req.params.id;
        const userId = req.query.userId;

        const lesson = await db.all('SELECT * FROM lessons WHERE lesson_id = ?', [lessonId]);
        if (lesson.length === 0) return res.status(404).json({ error: 'Урок не найден' });

        const tasks = await db.all('SELECT * FROM lesson_tasks WHERE lesson_id = ?', [lessonId]);

        let progress = null;
        if (userId) {
            const progRows = await db.all(
                'SELECT score, completed_at FROM user_progress WHERE user_id = ? AND lesson_id = ?',
                [userId, lessonId]
            );
            if (progRows.length > 0) progress = progRows[0];
        }

        res.json({ lesson: lesson[0], tasks: tasks, progress: progress });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/words', async (req, res) => {
    const lang = req.query.lang || 'en';
    try {
        const db = await dbPromise;
        const rows = await db.all('SELECT * FROM words WHERE lang_code = ? ORDER BY word', [lang]);
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/quiz-words', async (req, res) => {
    const lang = req.query.lang || 'en';
    try {
        const db = await dbPromise;
        const rows = await db.all('SELECT * FROM words WHERE lang_code = ? ORDER BY RANDOM() LIMIT 5', [lang]);
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/progress', async (req, res) => {
    const { userId, lessonId, score } = req.body;
    try {
        const db = await dbPromise;
        await db.run(`
            INSERT OR REPLACE INTO user_progress (user_id, lesson_id, score, completed_at)
            VALUES (?, ?, ?, datetime('now'))
        `, [userId, lessonId, score || 0]);

        const newBadges = await checkAchievements(userId);
        res.json({ success: true, newBadges });
    } catch (err) {
        console.error("Ошибка сохранения прогресса:", err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/user/achievements/:id', async (req, res) => {
    try {
        const db = await dbPromise;
        const rows = await db.all(`
            SELECT a.*, ua.earned_at 
            FROM achievements a
            JOIN user_achievements ua ON a.ach_id = ua.ach_id
            WHERE ua.user_id = ?
            ORDER BY ua.earned_at DESC
        `, [req.params.id]);
        res.json(rows);
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/teacher/award', async (req, res) => {
    const { teacherId, studentId, achievementId } = req.body;
    try {
        const db = await dbPromise;
        await db.run(
            'INSERT OR IGNORE INTO user_achievements (user_id, ach_id) VALUES (?, ?)',
            [studentId, achievementId]
        );
        await db.run(`
            UPDATE users 
            SET xp_points = xp_points + (SELECT xp_reward FROM achievements WHERE ach_id = ?) 
            WHERE user_id = ?
        `, [achievementId, studentId]);

        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/user/avatar', async (req, res) => {
    try {
        const db = await dbPromise;
        const { userId, avatarUrl } = req.body;
        await db.run('UPDATE users SET avatar = ? WHERE user_id = ?', [avatarUrl, userId]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/fix-avatars', async (req, res) => {
    try {
        const db = await dbPromise;
        const users = await db.all("SELECT user_id FROM users WHERE avatar IS NULL OR avatar = ''");

        const avatars = [
            'https://cdn-icons-png.flaticon.com/512/616/616430.png',
            'https://cdn-icons-png.flaticon.com/512/616/616408.png',
            'https://cdn-icons-png.flaticon.com/512/616/616440.png',
            'https://cdn-icons-png.flaticon.com/512/616/616458.png',
            'https://cdn-icons-png.flaticon.com/512/616/616460.png',
            'https://cdn-icons-png.flaticon.com/512/616/616492.png',
            'https://cdn-icons-png.flaticon.com/512/616/616554.png',
            'https://cdn-icons-png.flaticon.com/512/616/616409.png',
            'https://cdn-icons-png.flaticon.com/512/616/616569.png',
            'https://cdn-icons-png.flaticon.com/512/616/616494.png',
            'https://cdn-icons-png.flaticon.com/512/616/616489.png',
            'https://cdn-icons-png.flaticon.com/512/616/616566.png',
            'https://cdn-icons-png.flaticon.com/512/616/616470.png',
            'https://cdn-icons-png.flaticon.com/512/616/616538.png',
            'https://cdn-icons-png.flaticon.com/512/616/616515.png',
            'https://cdn-icons-png.flaticon.com/512/2922/2922510.png',
            'https://cdn-icons-png.flaticon.com/512/2922/2922561.png',
            'https://cdn-icons-png.flaticon.com/512/2922/2922522.png',
            'https://cdn-icons-png.flaticon.com/512/2922/2922579.png',
            'https://cdn-icons-png.flaticon.com/512/2922/2922506.png',
            'https://cdn-icons-png.flaticon.com/512/2922/2922566.png',
            'https://cdn-icons-png.flaticon.com/512/2922/2922656.png',
            'https://cdn-icons-png.flaticon.com/512/2922/2922608.png',
            'https://cdn-icons-png.flaticon.com/512/4322/4322991.png',
            'https://cdn-icons-png.flaticon.com/512/4712/4712109.png'
        ];

        for (const user of users) {
            const randomAvatar = avatars[Math.floor(Math.random() * avatars.length)];
            await db.run('UPDATE users SET avatar = ? WHERE user_id = ?', [randomAvatar, user.user_id]);
        }

        res.send('✅ Аватарки выданы!');
    } catch (e) { res.status(500).send('Ошибка: ' + e.message); }
});

module.exports = app;

if (require.main === module) {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`🚀 Сервер запущен локально: http://localhost:${PORT}`);
    });
}