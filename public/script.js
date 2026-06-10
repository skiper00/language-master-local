const API = '/api';

// ============================================================
// 1. МОДУЛЬ АВТОРИЗАЦИИ (AUTH)
// ============================================================
const auth = {
    token: localStorage.getItem('token'),
    user: JSON.parse(localStorage.getItem('user')) || null,

    init() {
        setTimeout(() => {
            const splash = document.getElementById('splash-screen');
            if (splash) {
                splash.style.opacity = 0;
                setTimeout(() => {
                    splash.style.display = 'none';
                    if (this.token && this.user) app.start(this.user);
                    else document.getElementById('auth-screen').style.display = 'flex';
                }, 500);
            }
        }, 2000);

        const loginForm = document.getElementById('login-form');
        if (loginForm) loginForm.onsubmit = this.handleLogin.bind(this);

        const regForm = document.getElementById('register-form');
        if (regForm) regForm.onsubmit = this.handleRegister.bind(this);
    },

    async handleLogin(e) {
        e.preventDefault();
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-pass').value;

        try {
            const res = await fetch(`${API}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            const data = await res.json();
            if (data.error) throw new Error(data.error);

            this.loginSuccess(data);
        } catch (err) { alert(err.message); }
    },

    async handleRegister(e) {
        e.preventDefault();
        const name = document.getElementById('reg-name').value;
        const email = document.getElementById('reg-email').value;
        const password = document.getElementById('reg-pass').value;
        const role = document.querySelector('input[name="role"]:checked').value;

        try {
            const res = await fetch(`${API}/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, email, password, role })
            });
            const data = await res.json();
            if (data.error) throw new Error(data.error);

            alert('Аккаунт создан! Войдите.');
            ui.showLogin();
        } catch (err) { alert(err.message); }
    },

    loginSuccess(data) {
        localStorage.setItem('token', data.token);
        localStorage.setItem('user', JSON.stringify(data.user));
        this.token = data.token;
        this.user = data.user;
        document.getElementById('auth-screen').style.display = 'none';
        app.start(data.user);
    },

    logout() {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        location.reload();
    },

    // Добавь это ВНУТРЬ объекта auth, после logout()
    async deleteAccount() {
        const pass = prompt("⚠️ Внимание!\nВы собираетесь удалить свой аккаунт и весь прогресс.\n\nВведите свой пароль для подтверждения:");

        if (!pass) return; // Нажал отмену

        try {
            const res = await fetch(`${API}/user`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: this.user.id, password: pass })
            });

            const data = await res.json();

            if (data.success) {
                alert('Аккаунт удален. Жаль, что вы уходите!');
                this.logout(); // Выходим из системы
            } else {
                alert('Ошибка: ' + data.error);
            }
        } catch (e) {
            alert('Ошибка соединения с сервером');
        }
    },
};

const ui = {
    showRegister: () => {
        document.getElementById('login-form').style.display = 'none';
        document.getElementById('register-form').style.display = 'block';
        document.getElementById('auth-title').innerText = 'Регистрация';
    },
    showLogin: () => {
        document.getElementById('register-form').style.display = 'none';
        document.getElementById('login-form').style.display = 'block';
        document.getElementById('auth-title').innerText = 'Вход в систему';
    }
};

// ============================================================
// 2. ОСНОВНОЕ ПРИЛОЖЕНИЕ (APP)
// ============================================================
const app = {
    user: null,
    currentLang: 'en',
    interfaceLang: 'ru',
    currentTab: 'home',
    completedLessons: [],
    streak: 0,
    currentLevel: 'A1',
    lastScroll: 0,
    totalLessonsCount: 0,
    currentTasks: [],      // Храним задачи здесь, чтобы проверить их в конце
    userAnswers: {},       // Ответы пользователя { taskId: 'ответ' }
    currentLessonId: null,

    translations: {
        ru: {
            home: 'Главная', lessons: 'Уроки', dictionary: 'Словарь', quiz: 'Тренировка',
            back: '← Назад', search: 'Поиск слова...', streak: 'Дней в ударе',
            statusDone: '✅ Пройдено', statusNotDone: '⭕ Не пройдено', dashboard: 'Мои классы'
        },
        en: {
            home: 'Home', lessons: 'Lessons', dictionary: 'Dictionary', quiz: 'Quiz',
            back: '← Back', search: 'Search word...', streak: 'Day Streak',
            statusDone: '✅ Completed', statusNotDone: '⭕ Not started', dashboard: 'My Classes'
        }
    },

    async start(user) {
        this.user = user;
        document.getElementById('app-container').style.display = 'flex';

        document.getElementById('user-name-display').innerText = user.name;
        document.getElementById('user-id-display').innerText = `ID: ${user.id}`;

        // Загружаем аватарку при старте
        this.updateSidebarAvatar();

        const langSelect = document.getElementById('lang-switch');
        if (langSelect) {
            langSelect.addEventListener('change', (e) => {
                this.interfaceLang = e.target.value;
                this.updateMenu();
                this.tab(this.currentTab);
            });
        }
        this.updateMenu();

        // Инициализируем плавающий виджет с ИИ-помощником для всех пользователей
        this.initAIAssistant();

        // Разделяем логику в зависимости от роли (учитель или ученик)
        if (user.role === 'teacher') {
            document.getElementById('student-nav').style.display = 'none';
            document.getElementById('teacher-nav').style.display = 'block';
            this.tab('dashboard'); // Сразу открываем дашборд
        } else {
            document.getElementById('student-nav').style.display = 'block';
            document.getElementById('teacher-nav').style.display = 'none';
            await this.loadProgress();
            this.calculateStreak();
            this.fetchTotalLessons();
            this.tab('home');
        }
    },

    speak(text) {
        // Отменяем прошлую речь, чтобы не накладывалась
        window.speechSynthesis.cancel();

        const msg = new SpeechSynthesisUtterance(text);
        msg.rate = 0.9; // Скорость
        msg.pitch = 1;  // Тон

        // 1. Пытаемся найти конкретный голос (Android/iOS часто требуют явного указания)
        const voices = window.speechSynthesis.getVoices();

        // Ищем английский голос (Google US English, Apple Samantha и т.д.)
        const enVoice = voices.find(v => v.lang.includes('en-US') || v.lang.includes('en-GB'));

        if (enVoice) {
            msg.voice = enVoice;
            msg.lang = enVoice.lang;
        } else {
            msg.lang = 'en-US'; // Запасной вариант
        }

        // 2. Исправление для iOS (иногда звук "глотается")
        msg.onend = function () { console.log('Озвучка завершена'); };
        msg.onerror = function (e) { console.error('Ошибка озвучки:', e); };

        window.speechSynthesis.speak(msg);

        // 3. Костыль для Chrome Android (иногда нужно пнуть синтезатор)
        if (window.speechSynthesis.paused) {
            window.speechSynthesis.resume();
        }
    },

    async loadProgress() {
        try {
            const res = await fetch(`${API}/progress/${this.user.id}`);
            const ids = await res.json();
            this.completedLessons = ids;
        } catch (e) { console.error(e); }
    },

    async fetchTotalLessons() {
        try {
            const res = await fetch(`${API}/lessons?lang=en`);
            const lessons = await res.json();
            this.allLessons = lessons; // Сохраняем весь массив уроков
            this.totalLessonsCount = lessons.length;
        } catch (e) { console.error(e); }
    },

    calculateStreak() {
        const lastDate = localStorage.getItem('lastLoginDate');
        const today = new Date().toDateString();
        let currentStreak = parseInt(localStorage.getItem('streak') || 0);

        if (lastDate !== today) {
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            if (lastDate === yesterday.toDateString()) {
                currentStreak++;
            } else {
                // Если это первый вход ИЛИ страйк сгорел — ставим 1
                currentStreak = 1;
            }
            localStorage.setItem('lastLoginDate', today);
            localStorage.setItem('streak', currentStreak);
        }
        this.streak = currentStreak;
    },

    updateMenu() {
        const t = this.translations[this.interfaceLang];
        // ... (твой старый код перевода кнопок) ...

        // --- ДОБАВЛЯЕМ КНОПКУ УДАЛЕНИЯ (Если её еще нет) ---
        const sidebarFooter = document.querySelector('.sidebar-footer');
        // Если у тебя нет footer, ищем просто sidebar
        const sidebar = document.querySelector('.sidebar') || document.getElementById('sidebar');

        if (sidebar && !document.getElementById('btn-delete-acc')) {
            const btn = document.createElement('button');
            btn.id = 'btn-delete-acc';
            btn.className = 'nav-btn'; // Или любой другой класс стиля
            btn.style.marginTop = '20px';
            btn.style.color = '#e74c3c'; // Красный цвет
            btn.style.border = '1px solid rgba(231, 76, 60, 0.3)';
            btn.innerHTML = `<i class="fas fa-user-times"></i> <span>Удалить аккаунт</span>`;

            btn.onclick = () => auth.deleteAccount();

            // Вставляем кнопку в самый низ
            if (sidebarFooter) sidebarFooter.appendChild(btn);
            else sidebar.appendChild(btn);
        }

        // Меняем текст кнопки при смене языка
        const delBtn = document.getElementById('btn-delete-acc');
        if (delBtn) {
            const delSpan = delBtn.querySelector('span');
            if (delSpan) delSpan.innerText = this.interfaceLang === 'ru' ? 'Удалить аккаунт' : 'Delete Account';
        }
    },

    tab(tabName) {
        if (this.currentTab === 'lessons' && tabName !== 'lessons') this.lastScroll = 0;
        this.currentTab = tabName;

        document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
        const activeBtn = document.getElementById(tabName === 'dashboard' ? 'btn-dashboard' : `btn-${tabName}`);
        if (activeBtn) activeBtn.classList.add('active');

        const area = document.getElementById('content-area');
        area.innerHTML = '';

        if (tabName === 'home') this.renderHome(area);
        else if (tabName === 'lessons') this.renderLevels(area);
        else if (tabName === 'dictionary') this.renderDictionary(area);
        else if (tabName === 'quiz') this.renderTraining(area);
        else if (tabName === 'dashboard') this.renderTeacherDashboard(area);
    },

    // ============================================================
    // 3. УЧИТЕЛЬ: ГЛАВНАЯ (АНАЛИТИКА)
    // ============================================================
    // Найти в script.js функцию renderHome(container) и заменить целиком:
    async renderHome(container) {
        // ==========================================
        // 1. ЛОГИКА ДЛЯ УЧИТЕЛЯ
        // ==========================================
        if (this.user.role === 'teacher') {
            // СНАЧАЛА рисуем каркас, чтобы loadTeacherAnalytics нашел элементы
            container.innerHTML = `
            <div class="welcome-box" style="background: linear-gradient(135deg, #2c3e50, #4ca1af);">
                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
                    <div>
                        <h1 style="margin:0">Центр Аналитики 📊</h1>
                        <p style="margin-top:5px; opacity:0.9">Статистика по классам</p>
                    </div>
                    <select id="class-filter" class="class-select" onchange="app.loadTeacherAnalytics()">
                        <option disabled>Загрузка...</option>
                    </select>
                </div>
            </div>

            <div class="analytics-grid" style="margin-bottom:20px;">
                <div class="stat-card">
                    <h3>🎓 Распределение</h3>
                    <div class="chart-container">
                        <div class="pie-chart" id="level-chart"></div>
                        <div class="chart-legend" id="level-legend"></div>
                    </div>
                </div>
                <div class="stat-card wide">
                    <h3>📈 Активность (7 дней)</h3>
                    <div class="bar-chart-wrap">
                        <div class="bar-chart" id="activity-chart">Загрузка...</div>
                        <div class="chart-axis" id="activity-axis"></div>
                    </div>
                </div>
            </div>

            <div class="lists-grid">
                <div class="list-card red">
                    <h3>⚠️ Внимание (< 3.5) <span id="count-attention">0</span></h3>
                    <div id="attention-list" class="risk-list"></div>
                </div>
                <div class="list-card yellow">
                    <h3>⚡ Хорошисты (3.5 - 4.4) <span id="count-mid">0</span></h3>
                    <div id="mid-list" class="risk-list"></div>
                </div>
                <div class="list-card green">
                    <h3>🌟 Отличники (4.5 - 5.0) <span id="count-top">0</span></h3>
                    <div id="top-list" class="risk-list"></div>
                </div>
            </div>
        `;

            // ТОЛЬКО ПОСЛЕ отрисовки вызываем загрузку данных
            this.initClassFilter();
            return;
        }

        // ==========================================
        // 2. ЛОГИКА ДЛЯ УЧЕНИКА
        // ==========================================

        // --- ЗАЩИТА: Ждем загрузки всех уроков с сервера ---
        if (!this.allLessons || this.allLessons.length === 0) {
            container.innerHTML = `
            <div style="padding:60px; text-align:center; color:var(--primary);">
                <i class="fas fa-spinner fa-spin fa-3x"></i>
                <p style="margin-top:20px; color:#7f8c8d;">Синхронизируем ваш прогресс...</p>
            </div>`;
            await this.fetchTotalLessons();
            // Если после запроса все равно пусто (ошибка сервера)
            if (!this.allLessons || this.allLessons.length === 0) {
                container.innerHTML = '<p style="text-align:center; padding:40px;">Ошибка загрузки уроков. Пожалуйста, обновите страницу.</p>';
                return;
            }
        }

        // Расчеты прогресса
        const currentLevelLessons = this.allLessons.filter(l => l.level_code === this.currentLevel);
        const totalInLevel = currentLevelLessons.length;
        const doneInLevel = currentLevelLessons.filter(l => this.completedLessons.includes(l.lesson_id)).length;
        const progressPercent = totalInLevel > 0 ? Math.round((doneInLevel / totalInLevel) * 100) : 0;

        // Ищем следующий урок
        const nextLesson = currentLevelLessons.find(l => !this.completedLessons.includes(l.lesson_id));

        // Загрузка Слова дня
        let wordOfDay = null;
        try {
            const wRes = await fetch(`${API}/word-of-day`);
            wordOfDay = await wRes.json();
        } catch (e) { console.error("Word of day error:", e); }

        // Рендерим новый дизайн
        container.innerHTML = `
        <div class="home-wrapper">
            
            <section class="hero-banner">
                <div class="hero-text">
                    <h1>Рады видеть, ${this.user.name}! 👋</h1>
                    <p>Твой прогресс в <b>${this.currentLevel}</b> — уже ${progressPercent}%</p>
                </div>
                <div class="hero-action">
                    <button class="primary-btn" style="background: white; color: #16a085; width: auto; padding: 15px 30px;" 
                            onclick="app.tab('lessons')">Ко всем урокам</button>
                </div>
            </section>

            <section class="quick-stats">
                <div class="mini-card">
                    <i class="fas fa-fire" style="background: #fef5f4; color: #e74c3c;"></i>
                    <div>
                        <b style="font-size: 1.2rem;">${this.streak}</b>
                        <p style="margin:0; font-size: 0.8rem; color: #7f8c8d;">Дней в ударе</p>
                    </div>
                </div>
                <div class="mini-card">
                    <i class="fas fa-graduation-cap" style="background: #eaf2f8; color: #3498db;"></i>
                    <div>
                        <b style="font-size: 1.2rem;">${doneInLevel} / ${totalInLevel}</b>
                        <p style="margin:0; font-size: 0.8rem; color: #7f8c8d;">Уроки уровня</p>
                    </div>
                </div>
                <div class="mini-card">
                    <i class="fas fa-check-circle" style="background: #fef9e7; color: #f1c40f;"></i>
                    <div>
                        <b style="font-size: 1.2rem;">${this.completedLessons.length}</b>
                        <p style="margin:0; font-size: 0.8rem; color: #7f8c8d;">Всего пройдено</p>
                    </div>
                </div>
            </section>

            <section class="next-lesson-spotlight">
                <div class="lesson-tag">ТВОЙ СЛЕДУЮЩИЙ ШАГ</div>
                ${nextLesson ? `
                    <h2 style="margin: 10px 0;">${nextLesson.title_ru}</h2>
                    <p style="color: #64748b; margin-bottom: 15px;">${nextLesson.description_ru || 'Продолжай изучение английского и открывай новые темы!'}</p>
                    <button class="primary-btn" style="width: fit-content; padding: 12px 40px;" 
                            onclick="app.openLesson(${nextLesson.lesson_id})">Начать урок</button>
                ` : `
                    <h2 style="margin: 10px 0;">Уровень ${this.currentLevel} пройден! 🎉</h2>
                    <p style="color: #64748b;">Великолепно! Ты освоил все темы этого этапа. Выбери следующий уровень в меню уроков.</p>
                `}
            </section>

            <div class="daily-word-flex">
                <div class="extra-card" style="text-align: left; align-items: flex-start;">
                    <div class="card-header-icon">💡 СЛОВО ДНЯ</div>
                    ${wordOfDay ? `
                        <h2 style="font-size: 2.2rem; margin: 10px 0 5px; color: var(--dark);">${wordOfDay.word}</h2>
                        <p style="font-size: 1.1rem; color: #7f8c8d; margin-bottom: 15px;">${wordOfDay.translation_ru}</p>
                        <button onclick="app.speak('${wordOfDay.word}')" class="wd-speak-btn">🔊 Слушать</button>
                    ` : '<p>Загрузка...</p>'}
                </div>

                <div class="extra-card" style="text-align: left; align-items: flex-start;">
                    <div class="card-header-icon">🧩 ТРЕНИРОВКА</div>
                    <h3 style="margin: 10px 0 5px;">Закрепи знания</h3>
                    <p style="color: #7f8c8d; font-size: 0.9rem; margin-bottom: 15px;">Минута в игровом режиме поможет не забыть старые темы.</p>
                    <button class="primary-btn" onclick="app.tab('quiz')" 
                            style="background: #34495e; padding: 10px 20px;">Перейти к играм</button>
                </div>
            </div>

        </div>
    `;
    },

    async initClassFilter() {
        try {
            const res = await fetch(`${API}/teacher/dashboard/${this.user.id}`);
            const classes = await res.json();
            const select = document.getElementById('class-filter');

            if (classes.length === 0) {
                select.innerHTML = '<option disabled>Нет классов</option>';
                return;
            }

            // Убираем "Все классы", сразу ставим первый класс
            let html = '';
            classes.forEach(c => {
                html += `<option value="${c.class_id}">${c.class_name}</option>`;
            });
            select.innerHTML = html;

            // Выбираем первый по умолчанию
            if (classes.length > 0) select.value = classes[0].class_id;

            this.loadTeacherAnalytics();
        } catch (e) { console.error(e); }
    },


    async loadTeacherAnalytics() {
        try {
            const classId = document.getElementById('class-filter').value;
            const resClasses = await fetch(`${API}/teacher/dashboard/${this.user.id}`);
            const classes = await resClasses.json();

            let filteredStudents = [];
            // Фильтруем студентов выбранного класса
            const target = classes.find(c => c.class_id == classId);
            filteredStudents = target ? target.students : [];

            // Подготавливаем данные: переводим средний балл в число
            filteredStudents.forEach(s => {
                s.lessons_done = parseInt(s.lessons_done) || 0;
                // Если average_grade есть, переводим во float, иначе ставим 0
                s.avg_num = s.average_grade ? parseFloat(s.average_grade) : 0;
            });

            // --- НОВАЯ СОРТИРОВКА ПО СРЕДНЕМУ БАЛЛУ ---
            // Отличники: балл 4.5 и выше
            const topStudents = filteredStudents.filter(s => s.avg_num >= 4.5).sort((a, b) => b.avg_num - a.avg_num);

            // Хорошисты: балл от 3.5 до 4.4
            const middle = filteredStudents.filter(s => s.avg_num >= 3.5 && s.avg_num < 4.5).sort((a, b) => b.avg_num - a.avg_num);

            // Требуют внимания: балл ниже 3.5 (включая тех, у кого нет оценок)
            const needAttention = filteredStudents.filter(s => s.avg_num < 3.5).sort((a, b) => a.avg_num - b.avg_num);

            if (document.getElementById('count-attention')) document.getElementById('count-attention').innerText = needAttention.length;
            if (document.getElementById('count-mid')) document.getElementById('count-mid').innerText = middle.length;
            if (document.getElementById('count-top')) document.getElementById('count-top').innerText = topStudents.length;

            // Изменяем вывод текста в карточке
            const renderRow = (s, colorClass, colorText) => {
                let gradeText = s.average_grade ? s.avg_num.toFixed(1) : 'Нет оценок';
                return `
                <div class="risk-item">
                    <span class="avatar-circle ${colorClass}" style="${colorClass === 'yellow' ? 'background:#f1c40f' : ''}">
                        ${s.avatar ? `<img src="${s.avatar}" style="width:100%; height:100%; border-radius:50%; object-fit:cover;">` : s.name[0]}
                    </span>
                    <div><b>${s.name}</b><div style="font-size:11px; color:${colorText}">Ср. балл: <b>${gradeText}</b></div></div>
                </div>`;
            };

            const renderList = (list, id, colorClass, colorText) => {
                const el = document.getElementById(id);
                if (el) el.innerHTML = list.length ? list.map(s => renderRow(s, colorClass, colorText)).join('') : `<div style="color:#ccc; padding:10px; font-size:13px">Пусто</div>`;
            };

            renderList(needAttention, 'attention-list', 'red', '#e74c3c');
            renderList(middle, 'mid-list', 'yellow', '#f39c12');
            renderList(topStudents, 'top-list', 'green', '#2ecc71');

            // --- ГРАФИК ---
            const resStats = await fetch(`${API}/teacher/stats/activity/${this.user.id}?classId=${classId}`);
            const rawData = await resStats.json();

            const toISODate = (d) => {
                if (typeof d === 'string') return d.substring(0, 10);
                const dateObj = new Date(d);
                return dateObj.toISOString().substring(0, 10);
            };

            const last7Days = [];
            for (let i = 6; i >= 0; i--) {
                const d = new Date();
                d.setDate(d.getDate() - i);
                last7Days.push(d);
            }

            const maxVal = Math.max(...rawData.map(d => d.count), 5);
            let barHTML = '', axisHTML = '';

            last7Days.forEach(dayObj => {
                const currentDayStr = toISODate(dayObj);
                const stat = rawData.find(d => toISODate(d.dateStr || d.date) === currentDayStr);
                const count = stat ? stat.count : 0;
                const height = Math.round((count / maxVal) * 100);
                const color = count > 0 ? '#3498db' : '#ecf0f1';
                const minH = count > 0 ? '4px' : '2px';

                barHTML += `<div class="bar" style="height: calc(${height}% + ${minH}); background:${color}" title="${currentDayStr}: ${count}"></div>`;
                axisHTML += `<span>${dayObj.toLocaleDateString(this.interfaceLang, { weekday: 'short' })}</span>`;
            });

            if (document.getElementById('activity-chart')) document.getElementById('activity-chart').innerHTML = barHTML;
            if (document.getElementById('activity-axis')) document.getElementById('activity-axis').innerHTML = axisHTML;

            // --- КРУГОВАЯ ДИАГРАММА ---
            const total = filteredStudents.length || 1;
            const p1 = (needAttention.length / total) * 100;
            const p2 = (middle.length / total) * 100;
            if (document.getElementById('level-chart'))
                document.getElementById('level-chart').style.background = `conic-gradient(#e74c3c 0% ${p1}%, #f1c40f ${p1}% ${p1 + p2}%, #2ecc71 ${p1 + p2}% 100%)`;

            if (document.getElementById('level-legend'))
                document.getElementById('level-legend').innerHTML = `
                    <div><span style="background:#e74c3c"></span> Внимание</div>
                    <div><span style="background:#f1c40f"></span> Хорошисты</div>
                    <div><span style="background:#2ecc71"></span> Отличники</div>
                `;

        } catch (e) { console.error(e); }
    },

    // ============================================================
    // 4. УЧИТЕЛЬ: УПРАВЛЕНИЕ КЛАССАМИ
    // ============================================================
    async renderTeacherDashboard(container) {
        container.innerHTML = `<h1>Мои классы</h1><div id="classes-loader">Загрузка...</div>`;

        try {
            const res = await fetch(`${API}/teacher/dashboard/${this.user.id}`);
            const classes = await res.json();

            let html = `
                <div class="create-class-box">
                    <input type="text" id="new-class-name" placeholder="Название нового класса (напр. 10-А)">
                    <button onclick="app.createClass()" class="primary-btn" style="width:auto; margin:0">Создать</button>
                </div>
            `;

            classes.forEach(cls => {
                html += `
                    <div class="class-card" id="card-class-${cls.class_id}">
                        <div class="class-header">
                            <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
                                <h3>${cls.class_name}</h3>
                                <button class="primary-btn" style="padding: 6px 12px; margin: 0; font-size: 0.85em; width: auto; background: #27ae60;" onclick="app.exportClassToCSV(${cls.class_id}, '${cls.class_name}')">
                                    <i class="fas fa-file-excel"></i> Отчет CSV
                                </button>
                                <button class="delete-btn" onclick="app.removeClass(${cls.class_id})" title="Удалить весь класс" style="font-size:1rem; margin:0;">
                                    <i class="fas fa-trash-alt"></i>
                                </button>
                            </div>
                            <span style="color:#7f8c8d">Учеников: ${cls.students.length}</span>
                        </div>
                        <div class="students-list">
                            ${cls.students.length === 0 ? '<p style="color:#ccc; font-style:italic">В этом классе пока нет учеников</p>' : ''}
                            ${cls.students.map(s => {
                    // Высчитываем и красим средний балл
                    let avgGradeText = '<span style="color:#95a5a6">Нет оценок</span>';
                    if (s.average_grade !== null && s.average_grade !== undefined) {
                        const grade = parseFloat(s.average_grade);
                        let color = '#e74c3c'; // Красный (Двойки)
                        if (grade >= 3.5) color = '#2ecc71'; // Зеленый (Четверки и Пятерки)
                        else if (grade >= 2.5) color = '#f1c40f'; // Желтый (Тройки)

                        // toFixed(1) оставит одну цифру после запятой (например, 4.2)
                        avgGradeText = `<b style="color:${color}; font-size:1.1em">${grade.toFixed(1)}</b>`;
                    }

                    return `
                                <div class="student-row">
                                    <div style="display:flex; align-items:center; gap:10px;">
                                        <img src="${s.avatar || `https://ui-avatars.com/api/?name=${s.name}&background=random`}" class="mini-avatar">
                                        <div class="st-info">
                                            <b>${s.name}</b> <small>(ID: ${s.user_id})</small><br>
                                            <small>Пройдено уроков: <b style="color:#3498db">${s.lessons_done}</b> | Средний балл: ${avgGradeText}</small>
                                        </div>
                                    </div>
                                    <button class="delete-btn" onclick="app.removeStudent(${cls.class_id}, ${s.user_id}, this)" title="Исключить">
                                        <i class="fas fa-user-minus"></i>
                                    </button>
                                </div>
                                `;
                }).join('')}
                        </div>
                        <div class="add-student-form">
                            <input type="number" id="add-st-${cls.class_id}" placeholder="ID ученика">
                            <button onclick="app.addStudent(${cls.class_id})"><i class="fas fa-plus"></i></button>
                        </div>
                    </div>
                `;
            });

            container.innerHTML = html;
        } catch (e) {
            container.innerHTML = `<p style="color:red">Ошибка: ${e.message}</p>`;
        }
    },

    async createClass() {
        const name = document.getElementById('new-class-name').value;
        if (!name) return;
        await fetch(`${API}/teacher/classes`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ teacherId: this.user.id, name })
        });
        this.tab('dashboard');
    },

    async addStudent(classId) {
        // 1. Находим поле ввода
        const input = document.getElementById(`add-st-${classId}`);

        // 2. Превращаем строку в число (Важно!)
        const studentId = parseInt(input.value);

        if (!studentId) {
            alert("Пожалуйста, введите корректный ID ученика (число).");
            return;
        }

        const btn = document.querySelector(`#card-class-${classId} .add-student-form button`);
        const oldIcon = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>'; // Показываем загрузку

        try {
            const res = await fetch(`${API}/teacher/add-student`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                // Отправляем studentId именно как число
                body: JSON.stringify({ classId, studentId })
            });

            // 3. Проверяем, не вернул ли сервер ошибку (HTML вместо JSON)
            const contentType = res.headers.get("content-type");
            if (!contentType || !contentType.includes("application/json")) {
                throw new Error("Сервер вернул ошибку (не JSON). Проверьте логи Vercel.");
            }

            const data = await res.json();

            if (data.error) {
                alert("Ошибка: " + data.error);
            } else {
                // Успех! Обновляем дашборд
                this.tab('dashboard');
            }
        } catch (e) {
            console.error(e);
            alert('Не удалось добавить ученика. Проверьте консоль браузера (F12).');
        } finally {
            // Возвращаем кнопку в исходное состояние
            btn.disabled = false;
            btn.innerHTML = oldIcon;
        }
    },

    async removeStudent(classId, studentId, btnElement) {
        if (!confirm('Исключить ученика из этого класса?')) return;
        const row = btnElement.closest('.student-row');
        row.style.opacity = '0.5';

        try {
            const res = await fetch(`${API}/teacher/remove-student`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ classId, studentId })
            });
            const data = await res.json();
            if (data.error) {
                alert(data.error); row.style.opacity = '1';
            } else {
                row.remove();
            }
        } catch (e) { console.error(e); row.style.opacity = '1'; }
    },

    async removeClass(classId) {
        if (!confirm('Вы уверены? Весь класс будет удален!')) return;
        const card = document.getElementById(`card-class-${classId}`);
        card.style.opacity = '0.5';

        try {
            const res = await fetch(`${API}/teacher/remove-class`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ classId })
            });
            const data = await res.json();
            if (data.error) {
                alert(data.error); card.style.opacity = '1';
            } else {
                card.remove();
            }
        } catch (e) { console.error(e); }
    },

    // --- АВАТАРКИ ---
    avatarsCollection: [
        'https://cdn-icons-png.flaticon.com/512/616/616430.png', 'https://cdn-icons-png.flaticon.com/512/616/616408.png',
        'https://cdn-icons-png.flaticon.com/512/616/616440.png', 'https://cdn-icons-png.flaticon.com/512/616/616458.png',
        'https://cdn-icons-png.flaticon.com/512/616/616460.png', 'https://cdn-icons-png.flaticon.com/512/616/616492.png',
        'https://cdn-icons-png.flaticon.com/512/616/616554.png', 'https://cdn-icons-png.flaticon.com/512/616/616409.png',
        'https://cdn-icons-png.flaticon.com/512/616/616569.png', 'https://cdn-icons-png.flaticon.com/512/616/616494.png',
        'https://cdn-icons-png.flaticon.com/512/616/616489.png', 'https://cdn-icons-png.flaticon.com/512/616/616566.png',
        'https://cdn-icons-png.flaticon.com/512/616/616470.png', 'https://cdn-icons-png.flaticon.com/512/616/616538.png',
        'https://cdn-icons-png.flaticon.com/512/616/616515.png', 'https://cdn-icons-png.flaticon.com/512/2922/2922510.png',
        'https://cdn-icons-png.flaticon.com/512/2922/2922561.png', 'https://cdn-icons-png.flaticon.com/512/2922/2922522.png',
        'https://cdn-icons-png.flaticon.com/512/2922/2922579.png', 'https://cdn-icons-png.flaticon.com/512/2922/2922506.png',
        'https://cdn-icons-png.flaticon.com/512/2922/2922566.png', 'https://cdn-icons-png.flaticon.com/512/2922/2922656.png',
        'https://cdn-icons-png.flaticon.com/512/2922/2922608.png', 'https://cdn-icons-png.flaticon.com/512/4322/4322991.png',
        'https://cdn-icons-png.flaticon.com/512/4712/4712109.png'
    ],

    openAvatarSelector() {
        const modal = document.getElementById('avatar-modal');
        const grid = document.getElementById('avatar-grid');
        grid.innerHTML = this.avatarsCollection.map(src => `<img src="${src}" class="avatar-option" onclick="app.setAvatar('${src}')">`).join('');
        modal.classList.add('active');
    },

    async setAvatar(url) {
        try {
            const res = await fetch(`${API}/user/avatar`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: this.user.id, avatarUrl: url }) });
            if ((await res.json()).success) {
                this.user.avatar = url;
                localStorage.setItem('user', JSON.stringify(this.user));
                this.updateSidebarAvatar();
                document.getElementById('avatar-modal').classList.remove('active');
            }
        } catch (e) { alert('Ошибка'); }
    },

    updateSidebarAvatar() {
        const img = document.getElementById('sidebar-avatar');
        const currentAvatar = this.user.avatar || this.avatarsCollection[0];
        if (img) img.src = currentAvatar;
    },

    // ============================================================
    // 5. УРОКИ И ИГРЫ
    // ============================================================
    async renderLevels(container) {
        const t = this.translations[this.interfaceLang];
        container.innerHTML = `<h2>${t.lessons}</h2><div id="levels-nav"></div><div id="lessons-list"></div>`;
        const nav = document.getElementById('levels-nav');

        const res = await fetch(`${API}/lessons?lang=en`);
        const lessons = await res.json();
        this.totalLessonsCount = lessons.length;

        ['A1', 'A2', 'B1', 'B2', 'C1'].forEach(lvl => {
            const btn = document.createElement('button');
            btn.className = 'lvl-tab';
            btn.innerText = lvl;
            btn.onclick = () => {
                if (this.currentLevel !== lvl) this.lastScroll = 0;
                this.currentLevel = lvl;
                document.querySelectorAll('.lvl-tab').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.showLessonsByLevel(lessons.filter(l => l.level_code === lvl));
            };
            nav.appendChild(btn);
        });

        const savedBtn = Array.from(nav.children).find(b => b.innerText === this.currentLevel);
        if (savedBtn) savedBtn.click();
        else if (nav.firstChild) nav.firstChild.click();
    },

    showLessonsByLevel(list) {
        const container = document.getElementById('lessons-list');
        container.innerHTML = list.map(l => `
            <div class="lesson-card ${this.completedLessons.includes(l.lesson_id) ? 'done' : ''}" onclick="app.openLesson(${l.lesson_id})">
                <div style="display:flex; justify-content:space-between; align-items:center; width:100%">
                    <h3>${l.title_ru}</h3>
                    ${this.completedLessons.includes(l.lesson_id) ? '<i class="fas fa-check-circle" style="color:#2ecc71"></i>' : ''}
                </div>
            </div>
        `).join('');

        if (this.lastScroll > 0) {
            setTimeout(() => {
                const main = document.querySelector('.main-content');
                if (main) main.scrollTop = this.lastScroll;
            }, 0);
        }
    },

    openLesson(id) {
        const main = document.querySelector('.main-content');
        this.lastScroll = main ? main.scrollTop : 0;
        this.loadLesson(id);
    },

    restoreProgress() {
        for (const [taskId, ans] of Object.entries(this.userAnswers)) {
            const card = document.getElementById(`card-${taskId}`);
            if (!card) continue;

            // Если это текст
            const input = document.getElementById(`input_${taskId}`);
            if (input) {
                input.value = ans;
                input.disabled = true;
                const btn = card.querySelector('button');
                if (btn) { btn.innerText = 'Принято'; btn.disabled = true; }
            }
            // Если это тест
            else {
                const radios = card.querySelectorAll('input[type="radio"]');
                radios.forEach(r => {
                    const label = r.closest('label');
                    const txt = label.querySelector('span').innerText.trim();
                    if (txt == ans) {
                        r.checked = true;
                        label.classList.add('selected');
                    }
                });
            }
            // Блокируем карту, так как ответ уже есть
            card.classList.add('locked');
        }
    },

    async loadLesson(id) {
        const res = await fetch(`${API}/lessons/${id}?userId=${this.user.id}`);
        const data = await res.json();

        this.currentLessonId = data.lesson.lesson_id;
        this.currentTasks = data.tasks || [];

        // Достаем черновик ответов
        const savedData = localStorage.getItem(`lesson_${this.user.id}_${this.currentLessonId}`);
        this.userAnswers = savedData ? JSON.parse(savedData) : {};

        // Проверяем, отмечен ли урок как пройденный (ручная кнопка)
        const isDone = this.completedLessons.includes(this.currentLessonId);

        let videoHTML = '';
        if (data.lesson.video_url) {
            const vUrl = data.lesson.video_url;
            if (vUrl.includes('youtube.com') || vUrl.includes('youtu.be')) {
                videoHTML = `<div class="video-container"><iframe src="${vUrl}" frameborder="0" allowfullscreen></iframe></div>`;
            } else {
                videoHTML = `<div class="video-container"><video controls width="100%" controlsList="nodownload" style="background: #000; display: block; max-height: 500px;"><source src="${vUrl}" type="video/mp4"></video></div>`;
            }
        }

        document.getElementById('content-area').innerHTML = `
            <button onclick="app.tab('lessons')" class="back-btn">← Назад</button>
            <div class="lesson-header" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 15px;">
                <h1 style="margin:0">${data.lesson.title_ru}</h1>
                <button id="manual-complete-btn" class="manual-complete-btn ${isDone ? 'done' : ''}" onclick="app.toggleLessonStatus(${this.currentLessonId}, this)">
                    <i class="fas ${isDone ? 'fa-check-circle' : 'fa-circle'}"></i> 
                    <span>${isDone ? 'Урок пройден' : 'Отметить как пройденный'}</span>
                </button>
            </div>
            <div class="theory-box">${data.lesson.theory_content}</div>
            ${videoHTML} 
            <div class="practice-section">
                <h2>Практика</h2>
                <div id="tasks-wrapper">${this.currentTasks.map((task, index) => this.renderTaskHTML(task, index)).join('')}</div>
                
                <div id="finish-btn-container" style="margin-top:30px;">
                    <button id="finish-lesson-btn" class="primary-btn" onclick="app.finishLesson()">Проверить ответы</button>
                </div>

                <div id="lesson-footer" class="lesson-footer" style="display:none; padding: 25px; text-align: center;">
                    <span class="result-score" id="res-score-text" style="font-size: 1.5em; font-weight: bold; color: #16a085;"></span>
                </div>
            </div>`;

        document.querySelector('.main-content').scrollTop = 0;

        // 1. Восстанавливаем ответы (текст, галочки)
        this.restoreProgress();

        // 2. Если урок уже проверяли ранее — сразу подсвечиваем ошибки и меняем кнопку
        const isChecked = localStorage.getItem(`lesson_${this.user.id}_${this.currentLessonId}_checked`) === 'true';
        if (isChecked) {
            let score = 0;
            this.currentTasks.forEach(task => {
                let userAns = (this.userAnswers[task.task_id] || '').toLowerCase().replace(/[?.!]/g, '').trim();
                let correctAns = (task.correct_answer || '').toLowerCase().replace(/[?.!]/g, '').trim();
                if (userAns === correctAns) score++;
            });
            this.showTaskFeedback(score);
        }
    },

    async toggleLessonStatus(id, btnElement) {
        const isCompleted = this.completedLessons.includes(id);

        const icon = btnElement.querySelector('i');
        const span = btnElement.querySelector('span');
        icon.className = 'fas fa-spinner fa-spin';

        try {
            await fetch(`${API}/manual-progress`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: this.user.id, lessonId: id, isCompleted: !isCompleted })
            });

            if (isCompleted) {
                // Снимаем отметку
                this.completedLessons = this.completedLessons.filter(lessonId => lessonId !== id);
                btnElement.classList.remove('done');
                icon.className = 'fas fa-circle';
                span.innerText = 'Отметить как пройденный';
            } else {
                // Ставим отметку
                this.completedLessons.push(id);
                btnElement.classList.add('done');
                icon.className = 'fas fa-check-circle';
                span.innerText = 'Урок пройден';
                this.fireConfetti();
            }
        } catch (e) {
            alert("Ошибка соединения с сервером");
            icon.className = isCompleted ? 'fas fa-check-circle' : 'fas fa-circle';
        }
    },

    // --- 2. ОТРИСОВКА ЗАДАНИЙ (ИСПРАВЛЕНА ОШИБКА .split) ---
    renderTaskHTML(task, index) {
        let content = '';

        if (task.task_type === 'multiple-choice') {
            let options = [];

            // ШАГ 1: Проверяем, может это уже массив?
            if (Array.isArray(task.options_json)) {
                options = task.options_json;
            }
            // ШАГ 2: Если это строка, пробуем прочитать
            else if (typeof task.options_json === 'string') {
                try {
                    // Пробуем как JSON
                    const parsed = JSON.parse(task.options_json);
                    if (Array.isArray(parsed)) options = parsed;
                    else options = [String(parsed)]; // Если вдруг там просто число
                } catch (e) {
                    // Если не JSON, значит просто текст через запятую
                    options = task.options_json.split(',').map(s => s.trim());
                }
            }
            // ШАГ 3: Защита от пустых значений
            else {
                options = [];
            }

            content = `<div class="options-group">${options.map(opt => `
                <label class="task-option" onclick="app.checkAnswer(this, '${opt}', ${task.task_id})">
                    <input type="radio" name="task_${task.task_id}">
                    <span>${opt}</span>
                </label>`).join('')}</div>`;
        } else {
            // Текстовый ввод
            content = `<div class="input-group">
                <input type="text" class="task-input" id="input_${task.task_id}" placeholder="Ваш ответ...">
                <button class="primary-btn" style="width:auto; margin:0 0 0 10px;" onclick="app.checkInput(${task.task_id})">OK</button>
            </div>`;
        }

        return `<div class="task-card" id="card-${task.task_id}"><p><b>${index + 1}.</b> ${task.question_text}</p>${content}</div>`;
    },

    showTaskFeedback(score) {
        // Эта функция просто красит карточки и блокирует инпуты
        this.currentTasks.forEach(task => {
            let userAns = (this.userAnswers[task.task_id] || '').toLowerCase().replace(/[?.!]/g, '').trim();
            let correctAns = (task.correct_answer || '').toLowerCase().replace(/[?.!]/g, '').trim();

            const card = document.getElementById(`card-${task.task_id}`);
            if (!card) return;

            // Блокируем поля, чтобы нельзя было хитрить после проверки
            card.querySelectorAll('input, select').forEach(el => el.disabled = true);
            card.classList.add('locked');

            let feedback = card.querySelector('.feedback');
            if (!feedback) {
                feedback = document.createElement('div');
                feedback.className = 'feedback';
                card.appendChild(feedback);
            }

            if (userAns === correctAns) {
                card.style.borderLeftColor = 'var(--success)';
                card.style.backgroundColor = '#f4fcf7';
                feedback.innerHTML = '✅ Верно!';
                feedback.style.background = '#eafaf1';
                feedback.style.color = '#27ae60';
            } else {
                card.style.borderLeftColor = 'var(--error)';
                card.style.backgroundColor = '#fdf4f4';
                feedback.innerHTML = `❌ Ошибка!<br><span style="font-size:0.9em; font-weight:normal;">Правильный ответ:</span> <b style="color:#c0392b;">${task.correct_answer}</b>`;
                feedback.style.background = '#fdeaea';
                feedback.style.color = '#c0392b';
            }
            feedback.classList.add('visible');
        });

        // Показываем результат
        const footer = document.getElementById('lesson-footer');
        if (footer) {
            footer.style.display = 'block';
            document.getElementById('res-score-text').innerText = `Твой результат: ${score} из ${this.currentTasks.length}`;
        }

        // Меняем кнопку на "Пересдать"
        document.getElementById('finish-btn-container').innerHTML = `
    <button id="retry-lesson-btn" 
            style="background: #4f46e5; color: white; padding: 12px 28px; border-radius: 50px; font-weight: 600; border: none; cursor: pointer; box-shadow: 0 4px 12px rgba(79, 70, 229, 0.3); display: inline-flex; align-items: center; gap: 8px; font-size: 15px;" 
            onclick="app.retryLesson()">
        <i class="fas fa-redo-alt"></i> Попробовать еще раз
    </button>
`;
    },

    async retryLesson() {
        if (!confirm("Вы уверены, что хотите стереть ответы и попробовать заново?")) return;

        try {
            // 1. Отправляем запрос на сервер для удаления баллов за этот урок из базы данных
            const response = await fetch(`${API}/progress`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: this.user.id, lessonId: this.currentLessonId })
            });

            if (!response.ok) {
                throw new Error("Не удалось удалить баллы на сервере");
            }

            // 2. Удаляем флаг проверки и сохраненные ответы из локального хранилища браузера
            localStorage.removeItem(`lesson_${this.user.id}_${this.currentLessonId}_checked`);
            localStorage.removeItem(`lesson_${this.user.id}_${this.currentLessonId}`);
            this.userAnswers = {};

            // 3. Очищаем визуал (снимаем блокировки и цвета)
            this.currentTasks.forEach(task => {
                const card = document.getElementById(`card-${task.task_id}`);
                if (!card) return;

                card.classList.remove('locked');
                card.style.borderLeftColor = 'var(--primary)';
                card.style.backgroundColor = '#fff';

                // Очищаем инпуты
                card.querySelectorAll('input').forEach(el => {
                    el.disabled = false;
                    if (el.type === 'radio' || el.type === 'checkbox') el.checked = false;
                    if (el.type === 'text') el.value = '';
                });

                // Сбрасываем стили кнопок/опций
                card.querySelectorAll('.task-option').forEach(opt => opt.classList.remove('selected'));
                card.querySelectorAll('button').forEach(btn => {
                    btn.disabled = false;
                    if (btn.innerText === 'Принято') btn.innerText = 'OK';
                });

                // Удаляем текст ошибок
                const feedback = card.querySelector('.feedback');
                if (feedback) feedback.remove();
            });

            const footer = document.getElementById('lesson-footer');
            if (footer) footer.style.display = 'none';

            // 4. Возвращаем исходную кнопку "Проверить"
            document.getElementById('finish-btn-container').innerHTML = `
                <button id="finish-lesson-btn" class="primary-btn" onclick="app.finishLesson()">Проверить ответы</button>
            `;

        } catch (e) {
            console.error(e);
            alert("Произошла ошибка соединения с сервером при сбросе баллов. Попробуйте еще раз.");
        }
    },


    async finishLesson() {
        const answeredIds = Object.keys(this.userAnswers);
        const validAnswers = answeredIds.filter(id => this.userAnswers[id] && this.userAnswers[id].trim() !== '');

        if (validAnswers.length < this.currentTasks.length) {
            alert(`⚠️ Вы ответили на ${validAnswers.length} из ${this.currentTasks.length} вопросов.\nЗаполните все задания перед проверкой!`);
            return;
        }

        // Подсчет баллов
        let score = 0;
        this.currentTasks.forEach(task => {
            let userAns = (this.userAnswers[task.task_id] || '').toLowerCase().replace(/[?.!]/g, '').trim();
            let correctAns = (task.correct_answer || '').toLowerCase().replace(/[?.!]/g, '').trim();
            if (userAns === correctAns) score++;
        });

        // 1. ОТПРАВЛЯЕМ БАЛЛЫ НА СЕРВЕР (теперь учитель увидит нормальный балл, а не 0.0)
        try {
            await fetch(`${API}/progress`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: this.user.id, lessonId: this.currentLessonId, score: score })
            });
        } catch (e) {
            console.error('Ошибка сохранения на сервере', e);
        }

        // 2. Запоминаем в браузере, что мы нажали "Проверить"
        localStorage.setItem(`lesson_${this.user.id}_${this.currentLessonId}_checked`, 'true');

        // 3. Вызываем подсветку UI
        this.showTaskFeedback(score);
    },

    // ВЫБОР В ТЕСТЕ
    checkAnswer(label, selected, taskId) {
        const card = label.closest('.task-card');
        if (card.classList.contains('locked')) return; // Если уже решал - выход

        // Сохраняем ответ
        this.userAnswers[taskId] = selected;
        localStorage.setItem(`lesson_${this.user.id}_${this.currentLessonId}`, JSON.stringify(this.userAnswers));

        // Визуально выбираем (просто синий цвет)
        label.querySelector('input').checked = true;
        label.classList.add('selected');

        // Блокируем задание
        card.classList.add('locked');
    },

    // ВВОД СЛОВА
    checkInput(taskId) {
        const input = document.getElementById(`input_${taskId}`);
        const val = input.value.trim();
        if (!val) return;

        const card = input.closest('.task-card');
        if (card.classList.contains('locked')) return;

        // Сохраняем
        this.userAnswers[taskId] = val;
        localStorage.setItem(`lesson_${this.user.id}_${this.currentLessonId}`, JSON.stringify(this.userAnswers));

        // Блокируем
        card.classList.add('locked');
        input.disabled = true;
        const btn = card.querySelector('button');
        if (btn) { btn.innerText = 'Принято'; btn.disabled = true; }
    },

    // ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ
    saveAnswer(taskId, answer) {
        this.userAnswers[taskId] = answer;
        // Сохраняем в браузер, чтобы не пропало при F5
        localStorage.setItem(`lesson_${this.user.id}_${this.currentLessonId}`, JSON.stringify(this.userAnswers));
    },

    lockTaskUI(taskId) {
        // Находим карточку задания
        let element = document.getElementById(`input_${taskId}`);
        if (!element) element = document.getElementsByName(`task_${taskId}`)[0];

        if (element) {
            const card = element.closest('.task-card');
            card.classList.add('locked'); // CSS сделает его полупрозрачным и некликабельным

            // Если это текстовое поле - дизейблим кнопку
            const btn = card.querySelector('button');
            if (btn) { btn.disabled = true; btn.innerText = 'Принято'; }
        }
    },

    lockAllInputs() {
        // Блокируем карточки
        document.querySelectorAll('.task-card').forEach(c => c.classList.add('locked'));
        // Блокируем инпуты и кнопки
        document.querySelectorAll('input, button.primary-btn').forEach(el => el.disabled = true);
        // Возвращаем кнопку "Назад" к жизни, а то она тоже заблокируется
        document.querySelector('.back-btn').disabled = false;
    },

    startCooldownTimer(minutes) {
        const timerBox = document.getElementById('res-timer');
        if (!timerBox) return;
        timerBox.style.display = 'inline-block';

        let seconds = Math.floor(minutes * 60);
        if (this.timerInterval) clearInterval(this.timerInterval);

        this.timerInterval = setInterval(() => {
            seconds--;
            if (seconds < 0) {
                clearInterval(this.timerInterval);
                timerBox.innerText = "✅ Можно пересдать!";
                return;
            }
            const m = Math.floor(seconds / 60).toString().padStart(2, '0');
            const s = (seconds % 60).toString().padStart(2, '0');
            timerBox.innerText = `⏳ Пересдача через: ${m}:${s}`;
        }, 1000);
    },

    async renderDictionary(container) {
        container.innerHTML = `
            <div style="margin-bottom: 20px;">
                <h1>📖 Словарь</h1>
                <div style="display:flex; gap:10px; flex-wrap:wrap;">
                    <input type="text" id="dict-search" class="form-control" placeholder="Поиск слова..." style="flex-grow:1; padding:10px; border:1px solid #ccc; border-radius:5px;">
                    <select id="dict-level-filter" style="padding:10px; border:1px solid #ccc; border-radius:5px; min-width:120px;">
                        <option value="ALL">Все уровни</option>
                        <option value="A1">A1</option>
                        <option value="A2">A2</option>
                        <option value="B1">B1</option>
                        <option value="B2">B2</option>
                        <option value="C1">C1</option>
                    </select>
                </div>
            </div>
            <div id="words-grid" class="words-grid">Загрузка...</div>
        `;

        const res = await fetch(`${API}/words?lang=en`);
        const words = await res.json();

        const draw = () => {
            const query = document.getElementById('dict-search').value.toLowerCase();
            const level = document.getElementById('dict-level-filter').value;

            const list = words.filter(w => {
                const matchSearch = w.word.toLowerCase().includes(query) || w.translation_ru.toLowerCase().includes(query);
                const matchLevel = level === 'ALL' || w.level_code === level;
                return matchSearch && matchLevel;
            });

            if (list.length === 0) {
                document.getElementById('words-grid').innerHTML = '<p style="color:#777">Ничего не найдено</p>';
                return;
            }

            document.getElementById('words-grid').innerHTML = list.map(w => `
                <div class="word-card" style="display:flex; justify-content:space-between; align-items:center; padding:15px; background:white; margin-bottom:10px; border-radius:8px; box-shadow:0 2px 5px rgba(0,0,0,0.05);">
                    <div>
                        <b style="font-size:1.1em; color:#2c3e50;">${w.word}</b> 
                        <span style="font-size:0.8em; background:#eee; padding:2px 6px; border-radius:4px; color:#555;">${w.level_code || 'A1'}</span>
                        <div style="color:#7f8c8d; font-size:0.9em; margin-top:2px;">${w.translation_ru}</div>
                    </div>
                    <button onclick="app.speak('${w.word}')" style="border:none; background:#ecf0f1; width:45px; height:45px; border-radius:50%; cursor:pointer; font-size:1.5rem; transition:0.2s;" title="Прослушать">🔊</button>
                </div>
            `).join('');
        };
        draw();

        document.getElementById('dict-search').oninput = draw;
        document.getElementById('dict-level-filter').onchange = draw;
    },

    async renderTraining(container) {
        const t = this.translations[this.interfaceLang];
        container.innerHTML = `
            <div id="training-menu">
                <h1>${t.quiz}</h1>
                <p style="color:#7f8c8d; margin-bottom:20px;">Выберите режим обучения:</p>
                <div class="modes-grid">
                    <div class="mode-card" id="btn-start-quiz"><span class="mode-icon">❓</span><h3>Викторина</h3><p>Выберите правильный перевод</p></div>
                    <div class="mode-card" id="btn-start-flashcards"><span class="mode-icon">🃏</span><h3>Карточки</h3><p>Вспомни и переверни</p></div>
                    <div class="mode-card" id="btn-start-sprint"><span class="mode-icon">⚡</span><h3>Спринт</h3><p>На скорость: верно или нет?</p></div>
                    <div class="mode-card" id="btn-start-builder"><span class="mode-icon">🧩</span><h3>Собери слово</h3><p>Составь слово из букв</p></div>
                    
                    <div class="mode-card" id="btn-start-pronunciation" style="border: 2px solid #3498db; background: #ebf5fb;">
                        <span class="mode-icon">🎙️</span>
                        <h3>Произношение</h3>
                        <p>Скажи слово в микрофон</p>
                    </div>
                </div>
            </div>
            <div id="game-area" class="game-container"></div>
        `;

        try {
            const res = await fetch(`${API}/words?lang=en`);
            let allWords = await res.json();
            allWords = allWords.sort(() => Math.random() - 0.5);

            if (allWords.length < 5) {
                container.innerHTML += `<p style="color:orange; margin-top:20px;">⚠️ В словаре мало слов для игр.</p>`;
                return;
            }

            document.getElementById('btn-start-quiz').onclick = () => this.startQuiz(allWords);
            document.getElementById('btn-start-flashcards').onclick = () => this.startFlashcards(allWords);
            document.getElementById('btn-start-sprint').onclick = () => this.startSprint(allWords);
            document.getElementById('btn-start-builder').onclick = () => this.startWordBuilder(allWords);
            document.getElementById('btn-start-pronunciation').onclick = () => this.startPronunciationTrainer(allWords);
        } catch (e) { console.error(e); }
    },

    quitGame() {
        if (this.sprintInterval) clearInterval(this.sprintInterval);
        this.renderTraining(document.getElementById('content-area'));
    },

    // --- GAME 1: QUIZ ---
    startQuiz(words) {
        document.getElementById('training-menu').style.display = 'none';
        const gameArea = document.getElementById('game-area');
        gameArea.style.display = 'block';
        gameArea.innerHTML = '';

        let score = 0;
        let qCount = 0;
        const maxQuestions = 10;

        const nextQ = () => {
            if (qCount >= maxQuestions) { this.showGameOver(score, maxQuestions * 20, gameArea); return; }
            qCount++;
            const correct = words[Math.floor(Math.random() * words.length)];
            const distractors = [];
            while (distractors.length < 3) {
                const w = words[Math.floor(Math.random() * words.length)];
                if (w.word !== correct.word && !distractors.includes(w)) distractors.push(w);
            }
            const options = [correct, ...distractors].sort(() => Math.random() - 0.5);

            gameArea.innerHTML = `
                <div class="game-header"><button class="back-btn" id="quit-btn">Выход</button><span>${qCount}/${maxQuestions}</span></div>
                <div class="quiz-word">${correct.word}</div>
                <div class="quiz-options">${options.map(opt => `<button class="quiz-btn" data-id="${opt.word_id}">${opt.translation_ru}</button>`).join('')}</div>
            `;
            document.getElementById('quit-btn').onclick = () => this.quitGame();

            gameArea.querySelectorAll('.quiz-btn').forEach(btn => {
                btn.onclick = (e) => {
                    gameArea.querySelectorAll('.quiz-btn').forEach(b => b.disabled = true);
                    const id = parseInt(e.target.getAttribute('data-id'));
                    if (id === correct.word_id) {
                        e.target.style.background = '#d4edda'; score += 20;
                    } else {
                        e.target.style.background = '#f8d7da';
                        [...gameArea.querySelectorAll('.quiz-btn')].find(b => parseInt(b.getAttribute('data-id')) === correct.word_id).style.background = '#d4edda';
                    }
                    setTimeout(nextQ, 1000);
                };
            });
        };
        nextQ();
    },

    // --- GAME 2: FLASHCARDS ---
    startFlashcards(words) {
        document.getElementById('training-menu').style.display = 'none';
        const gameArea = document.getElementById('game-area');
        gameArea.style.display = 'block';
        let index = 0;
        const sessionWords = [...words].slice(0, 15);

        const renderCard = () => {
            if (index >= sessionWords.length) { this.quitGame(); return; }
            const word = sessionWords[index];
            gameArea.innerHTML = `
                <div class="game-header"><button class="back-btn" id="quit-btn">Выход</button><span>${index + 1}/${sessionWords.length}</span></div>
                <div class="flashcard" id="card"><div id="card-content">${word.word}</div><div class="flashcard-hint">Нажми</div></div>
                <div class="fc-controls"><button class="fc-btn unknow" id="btn-unknow">Не знаю</button><button class="fc-btn know" id="btn-know">Знаю</button></div>
            `;
            document.getElementById('quit-btn').onclick = () => this.quitGame();
            const card = document.getElementById('card');
            let isEng = true;
            card.onclick = () => {
                card.classList.toggle('flipped'); isEng = !isEng;
                document.getElementById('card-content').innerText = isEng ? word.word : word.translation_ru;
            };
            const next = () => { index++; renderCard(); };
            document.getElementById('btn-unknow').onclick = next;
            document.getElementById('btn-know').onclick = next;
        };
        renderCard();
    },

    // --- GAME 3: SPRINT ---
    startSprint(words) {
        document.getElementById('training-menu').style.display = 'none';
        const gameArea = document.getElementById('game-area');
        gameArea.style.display = 'block';
        let score = 0;
        let timeLeft = 60;
        if (this.sprintInterval) clearInterval(this.sprintInterval);

        const renderFrame = () => {
            const correct = words[Math.floor(Math.random() * words.length)];
            const showCorrect = Math.random() > 0.5;
            let shownTrans = correct.translation_ru;
            if (!showCorrect) shownTrans = words[Math.floor(Math.random() * words.length)].translation_ru;

            gameArea.innerHTML = `
                <div class="game-header"><button class="back-btn" id="quit-btn">Выход</button><span>Очки: ${score}</span></div>
                <div class="timer-bar"><div class="timer-fill" style="width: ${(timeLeft / 60) * 100}%"></div></div>
                <div class="sprint-word">${correct.word}</div>
                <div class="sprint-translation">${shownTrans}</div>
                <div class="sprint-controls"><button class="sprint-btn false" id="btn-false">Неверно</button><button class="sprint-btn true" id="btn-true">Верно</button></div>
            `;
            document.getElementById('quit-btn').onclick = () => this.quitGame();
            const check = (val) => {
                if (val === showCorrect) score += 10; else score = Math.max(0, score - 5);
                renderFrame();
            };
            document.getElementById('btn-true').onclick = () => check(true);
            document.getElementById('btn-false').onclick = () => check(false);
        };
        renderFrame();
        this.sprintInterval = setInterval(() => {
            timeLeft--;
            if (timeLeft <= 0) {
                clearInterval(this.sprintInterval);
                this.showGameOver(score, 1000, gameArea);
            } else {
                const bar = document.querySelector('.timer-fill');
                if (bar) bar.style.width = `${(timeLeft / 60) * 100}%`;
            }
        }, 1000);
    },

    // --- GAME 4: WORD BUILDER ---
    startWordBuilder(words) {
        document.getElementById('training-menu').style.display = 'none';
        const gameArea = document.getElementById('game-area');
        gameArea.style.display = 'block';
        let round = 0, score = 0; const maxRounds = 10;

        const nextWord = () => {
            if (round >= maxRounds) { this.showGameOver(score, maxRounds * 20, gameArea); return; }
            round++;
            let wordObj = words[Math.floor(Math.random() * words.length)];
            while (wordObj.word.length < 3) wordObj = words[Math.floor(Math.random() * words.length)];
            const target = wordObj.word.toLowerCase();
            const letters = target.split('').sort(() => Math.random() - 0.5);
            let guess = [];

            const render = () => {
                let result = '';
                if (guess.length === target.length) {
                    if (guess.join('') === target) {
                        result = '<p style="color:green">✅ Верно!</p>'; score += 20; setTimeout(nextWord, 800);
                    } else {
                        result = '<p style="color:red">❌ Ошибка</p>'; setTimeout(() => { guess = []; render(); }, 800);
                    }
                }

                gameArea.innerHTML = `
                    <div class="game-header"><button class="back-btn" id="quit-btn">Выход</button><span>${round}/${maxRounds}</span></div>
                    <div class="wb-target">${wordObj.translation_ru}</div>
                    <div class="wb-slots">${Array(target.length).fill(0).map((_, i) => `<div class="wb-slot">${guess[i] || ''}</div>`).join('')}</div>
                    ${result}
                    <div class="wb-letters">${letters.map(char => {
                    const used = guess.filter(c => c === char).length >= letters.filter(c => c === char && letters.indexOf(c) <= letters.lastIndexOf(char)).length;
                    return `<button class="wb-letter-btn ${used ? 'used' : ''}" data-char="${char}">${char}</button>`;
                }).join('')}</div>
                    <button class="back-btn" id="reset-btn" style="margin-top:20px; color:orange">Сброс</button>
                `;
                document.getElementById('quit-btn').onclick = () => this.quitGame();
                document.getElementById('reset-btn').onclick = () => { guess = []; render(); };

                gameArea.querySelectorAll('.wb-letter-btn').forEach(btn => {
                    btn.onclick = () => {
                        if (guess.length < target.length) {
                            guess.push(btn.getAttribute('data-char')); render();
                        }
                    }
                });
            };
            render();
        };
        nextWord();
    },

    initAIAssistant() {
        if (document.getElementById('ai-widget-container')) return;

        const container = document.createElement('div');
        container.id = 'ai-widget-container';
        container.innerHTML = `
            <button id="ai-widget-btn" style="position: fixed; bottom: 25px; right: 25px; z-index: 9999; border-radius: 50%; width: 65px; height: 65px; background: linear-gradient(135deg, #9b59b6, #8e44ad); color: white; border: none; box-shadow: 0 4px 15px rgba(155, 89, 182, 0.4); cursor: pointer; font-size: 28px; transition: transform 0.2s; display: flex; justify-content: center; align-items: center;">
                🤖
            </button>
            
            <div id="ai-chat-panel" class="ai-chat-container" style="display: none; position: fixed; bottom: 100px; right: 25px; z-index: 9999; width: 380px; height: 550px; background: #f9f9fb; border-radius: 20px; box-shadow: 0 10px 40px rgba(0,0,0,0.2); flex-direction: column; overflow: hidden; border: 1px solid #eaeaea; transition: all 0.4s cubic-bezier(0.165, 0.84, 0.44, 1);">
                
                <div style="background: linear-gradient(135deg, #9b59b6, #8e44ad); color: white; padding: 18px 25px; display: flex; justify-content: space-between; align-items: center; flex-shrink: 0; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
                    <h3 style="margin: 0; font-size: 1.1rem; display: flex; align-items: center; gap: 10px;">
                        <i class="fas fa-robot"></i> ИИ-Помощник
                    </h3>
                    <div style="display: flex; gap: 15px; align-items: center;">
                        <button id="ai-chat-maximize" title="Развернуть" style="background: transparent; border: none; color: white; font-size: 16px; cursor: pointer; opacity: 0.8; transition: 0.2s;">
                            <i class="fas fa-expand-alt"></i>
                        </button>
                        <button id="ai-chat-close" style="background: transparent; border: none; color: white; font-size: 24px; cursor: pointer; line-height: 1; opacity: 0.8;">&times;</button>
                    </div>
                </div>
                
                <div id="ai-chat-history" class="ai-chat-messages" style="flex-grow: 1; padding: 20px; overflow-y: auto; display: flex; flex-direction: column; gap: 15px; background: #ffffff;">
                    <div id="ai-messages-inner" style="width: 100%; max-width: 800px; margin: 0 auto; display: flex; flex-direction: column; gap: 15px;">
                        <div style="align-self: flex-start; background: #f0f2f5; color: #2c3e50; padding: 12px 18px; border-radius: 18px 18px 18px 4px; max-width: 80%; line-height: 1.5; font-size: 0.95em; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
                        🤖 Привет! Я ваш ИИ-помощник по изучению языка. Вы можете прислать мне фразу для перевода, попросить объяснить правило или проверить ваш текст на ошибки. С чего начнем?
                        </div>
                    </div>
                </div>
                
                <div style="padding: 15px 20px; background: #ffffff; border-top: 1px solid #eee; display: flex; justify-content: center; flex-shrink: 0;">
                    <div style="width: 100%; max-width: 800px; display: flex; gap: 12px; align-items: center;">
                        <input type="text" id="ai-chat-input" class="ai-chat-input" placeholder="Введите сообщение..." autocomplete="off" style="flex-grow: 1; padding: 12px 20px; border: 1px solid #e0e0e0; border-radius: 25px; outline: none; font-size: 1em; transition: 0.3s; background: #f8f9fa;">
                        <button id="ai-chat-send" style="background: #9b59b6; color: white; border: none; border-radius: 50%; width: 48px; height: 48px; cursor: pointer; display: flex; align-items: center; justify-content: center; box-shadow: 0 4px 10px rgba(155, 89, 182, 0.3); transition: 0.3s;">
                            <i class="fas fa-paper-plane"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(container);

        const btn = document.getElementById('ai-widget-btn');
        const panel = document.getElementById('ai-chat-panel');
        const closeBtn = document.getElementById('ai-chat-close');
        const maxBtn = document.getElementById('ai-chat-maximize');
        const input = document.getElementById('ai-chat-input');
        const sendBtn = document.getElementById('ai-chat-send');
        const historyInner = document.getElementById('ai-messages-inner');
        const historyOuter = document.getElementById('ai-chat-history');

        let isMaximized = false;

        maxBtn.onclick = () => {
            if (!isMaximized) {
                panel.style.width = 'calc(100% - 40px)';
                panel.style.height = 'calc(100% - 40px)';
                panel.style.bottom = '20px';
                panel.style.right = '20px';
                panel.style.borderRadius = '15px';
                maxBtn.innerHTML = '<i class="fas fa-compress-alt"></i>';
            } else {
                panel.style.width = '380px';
                panel.style.height = '550px';
                panel.style.bottom = '100px';
                panel.style.right = '25px';
                panel.style.borderRadius = '20px';
                maxBtn.innerHTML = '<i class="fas fa-expand-alt"></i>';
            }
            isMaximized = !isMaximized;
        };

        btn.onclick = () => { panel.style.display = 'flex'; btn.style.transform = 'scale(0)'; input.focus(); };
        closeBtn.onclick = () => { panel.style.display = 'none'; btn.style.transform = 'scale(1)'; };

        let chatHistory = [];

        const sendMessage = async () => {
            const text = input.value.trim();
            if (!text) return;
            chatHistory.push({ role: 'user', text: text });

            historyInner.innerHTML += `
                <div style="align-self: flex-end; background: #9b59b6; color: white; padding: 12px 18px; border-radius: 18px 18px 4px 18px; max-width: 80%; line-height: 1.5; font-size: 0.95em; box-shadow: 0 4px 10px rgba(155, 89, 182, 0.2);">
                    ${text}
                </div>`;
            input.value = '';
            historyOuter.scrollTop = historyOuter.scrollHeight;

            const loadId = 'loading-' + Date.now();
            historyInner.innerHTML += `<div id="${loadId}" style="align-self: flex-start; background: #f0f2f5; padding: 12px 18px; border-radius: 15px;"><i class="fas fa-circle-notch fa-spin"></i></div>`;
            historyOuter.scrollTop = historyOuter.scrollHeight;

            try {
                const res = await fetch(`${API}/chat`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ history: chatHistory })
                });
                const data = await res.json();
                if (document.getElementById(loadId)) document.getElementById(loadId).remove();

                chatHistory.push({ role: 'ai', text: data.reply });
                let formattedReply = data.reply.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
                historyInner.innerHTML += `
                    <div style="align-self: flex-start; background: #f0f2f5; color: #2c3e50; padding: 12px 18px; border-radius: 18px 18px 18px 4px; max-width: 80%; line-height: 1.5; font-size: 0.95em; box-shadow: 0 1px 2px rgba(0,0,0,0.05);">
                        ${formattedReply}
                    </div>`;
            } catch (e) {
                if (document.getElementById(loadId)) document.getElementById(loadId).remove();
                historyInner.innerHTML += `<div style="color: red; padding: 10px; text-align: center;">⚠️ Ошибка связи</div>`;
            }
            historyOuter.scrollTop = historyOuter.scrollHeight;
        };

        sendBtn.onclick = sendMessage;
        input.onkeypress = (e) => { if (e.key === 'Enter') sendMessage(); };
    },

    // --- GAME 6: AI CHATBOT TUTOR ---
    startAIChat() {
        document.getElementById('training-menu').style.display = 'none';
        const gameArea = document.getElementById('game-area');
        gameArea.style.display = 'block';

        // Рисуем интерфейс чата (стили встроены для простоты)
        gameArea.innerHTML = `
            <div class="game-header">
                <button class="back-btn" id="quit-chat-btn">Выход</button>
                <span>ИИ-Репетитор 🤖</span>
            </div>
            
            <div class="chat-container" style="display:flex; flex-direction:column; height: 60vh; background: #fdfdfd; border: 1px solid #eee; border-radius: 10px; padding: 15px; margin-top: 15px;">
                
                <div id="chat-history" style="flex-grow: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 15px; padding-bottom: 15px;">
                    <div style="align-self: flex-start; background: #ebf5fb; color: #2c3e50; padding: 12px 18px; border-radius: 15px 15px 15px 0; max-width: 80%; line-height: 1.4;">
                        Hello there! I'm your AI English tutor. 👋 Let's practice! How was your day?
                    </div>
                </div>

                <div style="display:flex; gap:10px; margin-top: 15px;">
                    <input type="text" id="chat-input" placeholder="Type here in English..." autocomplete="off" style="flex-grow: 1; padding: 12px 20px; border: 2px solid #ecf0f1; border-radius: 25px; outline: none; font-size: 1rem; transition: border 0.3s;">
                    <button id="chat-send-btn" class="primary-btn" style="margin: 0; border-radius: 25px; padding: 0 25px; min-width: 80px;">
                        <i class="fas fa-paper-plane"></i>
                    </button>
                </div>
            </div>
        `;

        document.getElementById('quit-chat-btn').onclick = () => this.quitGame();

        const input = document.getElementById('chat-input');
        const sendBtn = document.getElementById('chat-send-btn');
        const historyDiv = document.getElementById('chat-history');

        // Логика отправки
        const sendMessage = async () => {
            const text = input.value.trim();
            if (!text) return;

            // 1. Рисуем сообщение пользователя
            historyDiv.innerHTML += `
                <div style="align-self: flex-end; background: #d5f5e3; color: #1e8449; padding: 12px 18px; border-radius: 15px 15px 0 15px; max-width: 80%; line-height: 1.4; box-shadow: 0 2px 5px rgba(0,0,0,0.05);">
                    ${text}
                </div>`;
            input.value = '';
            historyDiv.scrollTop = historyDiv.scrollHeight; // Скролл вниз

            // 2. Рисуем индикатор "печатает..."
            const loadId = 'loading-' + Date.now();
            historyDiv.innerHTML += `
                <div id="${loadId}" style="align-self: flex-start; background: #f8f9fa; color: #95a5a6; padding: 12px 18px; border-radius: 15px 15px 15px 0;">
                    <i class="fas fa-ellipsis-h fa-fade"></i> AI is thinking...
                </div>`;
            historyDiv.scrollTop = historyDiv.scrollHeight;

            try {
                // Отправляем запрос на наш бэкенд
                const res = await fetch(`${API}/chat`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ message: text })
                });

                const data = await res.json();
                document.getElementById(loadId).remove(); // Удаляем индикатор загрузки

                if (data.error) {
                    historyDiv.innerHTML += `<div style="align-self: flex-start; background: #fdeaea; color: #e74c3c; padding: 12px 18px; border-radius: 15px 15px 15px 0;">⚠️ ${data.error}</div>`;
                } else {
                    // Конвертируем **жирный текст** от нейросети в HTML
                    let formattedReply = data.reply.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');

                    historyDiv.innerHTML += `
                        <div style="align-self: flex-start; background: #ebf5fb; color: #2c3e50; padding: 12px 18px; border-radius: 15px 15px 15px 0; max-width: 80%; line-height: 1.4; box-shadow: 0 2px 5px rgba(0,0,0,0.05);">
                            ${formattedReply}
                        </div>`;
                }
            } catch (e) {
                document.getElementById(loadId).remove();
                historyDiv.innerHTML += `<div style="align-self: flex-start; background: #fdeaea; color: #e74c3c; padding: 12px 18px; border-radius: 15px 15px 15px 0;">⚠️ Ошибка соединения с сервером!</div>`;
            }
            historyDiv.scrollTop = historyDiv.scrollHeight;
        };

        // Обработчики клика и Enter
        sendBtn.onclick = sendMessage;
        input.onkeypress = (e) => { if (e.key === 'Enter') sendMessage(); };

        // Красивый эффект на фокус инпута
        input.addEventListener('focus', () => input.style.borderColor = '#3498db');
        input.addEventListener('blur', () => input.style.borderColor = '#ecf0f1');
    },

    // --- GAME 5: PRONUNCIATION TRAINER ---
    startPronunciationTrainer(words) {
        // Проверяем поддержку технологии браузером
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            alert("⚠️ Ваш браузер не поддерживает распознавание речи. Рекомендуем использовать Google Chrome или Яндекс.Браузер.");
            return;
        }

        document.getElementById('training-menu').style.display = 'none';
        const gameArea = document.getElementById('game-area');
        gameArea.style.display = 'block';

        let round = 0, score = 0;
        const maxRounds = 5; // Сделаем 5 слов для начала, чтобы не уставать

        // Настраиваем "слухача"
        const recognition = new SpeechRecognition();
        recognition.lang = 'en-US'; // Ожидаем английскую речь
        recognition.interimResults = false; // Ждем, пока пользователь договорит
        recognition.maxAlternatives = 1;

        let isListening = false;

        const nextWord = () => {
            if (round >= maxRounds) { this.showGameOver(score, maxRounds * 20, gameArea); return; }
            round++;

            // Берем случайное слово и убираем знаки препинания для проверки
            let wordObj = words[Math.floor(Math.random() * words.length)];
            let targetWord = wordObj.word.toLowerCase().replace(/[.,?!]/g, '').trim();

            gameArea.innerHTML = `
                <div class="game-header"><button class="back-btn" id="quit-btn">Выход</button><span>${round}/${maxRounds}</span></div>
                
                <div style="text-align: center; margin-top: 40px; padding: 20px;">
                    <div style="font-size: 1.2rem; color: #7f8c8d; margin-bottom: 10px;">Прочитай вслух:</div>
                    <h2 style="font-size: 3rem; color: #2c3e50; margin: 0; letter-spacing: 2px;">${wordObj.word}</h2>
                    <div style="color: #95a5a6; font-size: 1.1rem; margin-top: 10px;">${wordObj.translation_ru}</div>

                    <div style="margin: 50px auto;">
                        <button id="mic-btn" style="background: #f1f2f6; border: 2px solid #dfe6e9; border-radius: 50%; width: 100px; height: 100px; font-size: 3rem; cursor: pointer; transition: all 0.3s ease; display: flex; align-items: center; justify-content: center; margin: 0 auto; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">
                            🎙️
                        </button>
                    </div>
                    
                    <div id="speech-result" style="font-size: 1.2rem; min-height: 60px; font-weight: bold;">
                        <span style="color: #bdc3c7; font-weight: normal;">Нажми на микрофон и скажи слово</span>
                    </div>
                </div>
            `;

            const micBtn = document.getElementById('mic-btn');
            const resultDiv = document.getElementById('speech-result');

            document.getElementById('quit-btn').onclick = () => {
                if (isListening) recognition.stop();
                this.quitGame();
            };

            // Клик по микрофону
            micBtn.onclick = () => {
                if (isListening) {
                    recognition.stop();
                    return;
                }
                try {
                    recognition.start();
                } catch (e) {
                    console.error("Ошибка старта микрофона", e);
                }
            };

            // Анимация при записи
            recognition.onstart = () => {
                isListening = true;
                micBtn.style.background = '#ffeaa7';
                micBtn.style.borderColor = '#f1c40f';
                micBtn.style.boxShadow = '0 0 20px rgba(241, 196, 15, 0.5)';
                micBtn.style.transform = 'scale(1.1)';
                resultDiv.innerHTML = '<span style="color: #f39c12; animation: pulse 1.5s infinite;">Слушаю вас... 👂</span>';
            };

            // Остановка записи
            recognition.onspeechend = () => {
                recognition.stop();
            };

            // Когда распознавание завершилось (успешно или нет)
            recognition.onend = () => {
                isListening = false;
                if (micBtn) {
                    micBtn.style.background = '#f1f2f6';
                    micBtn.style.borderColor = '#dfe6e9';
                    micBtn.style.boxShadow = '0 4px 6px rgba(0,0,0,0.1)';
                    micBtn.style.transform = 'scale(1)';
                }
            };

            // Проверка результата
            recognition.onresult = (event) => {
                // Получаем то, что услышал браузер
                const transcript = event.results[0][0].transcript.toLowerCase().replace(/[.,?!]/g, '').trim();

                // Проверяем: совпало ли точно, или пользователь сказал слово в составе фразы
                if (transcript === targetWord || transcript.includes(targetWord)) {
                    resultDiv.innerHTML = `<span style="color: #2ecc71;">✅ Идеально!<br><small style="color:#7f8c8d; font-weight:normal;">Вы сказали: "${transcript}"</small></span>`;
                    score += 20;
                    setTimeout(nextWord, 2000); // Переход к следующему слову через 2 секунды
                } else {
                    resultDiv.innerHTML = `<span style="color: #e74c3c;">❌ Почти!<br><small style="color:#7f8c8d; font-weight:normal;">Браузер услышал: "${transcript}"</small></span>`;
                }
            };

            recognition.onerror = (event) => {
                if (event.error === 'not-allowed') {
                    resultDiv.innerHTML = `<span style="color: #e74c3c;">⚠️ Дайте разрешение на использование микрофона в браузере.</span>`;
                } else {
                    resultDiv.innerHTML = `<span style="color: #e67e22;">⚠️ Не удалось распознать (${event.error}). Попробуйте еще раз.</span>`;
                }
            };
        };

        nextWord();
    },

    showGameOver(score, total, container) {
        if (score > 0) this.fireConfetti();
        container.innerHTML = `
            <div class="result-modal">
                <span class="result-emoji-big">🏆</span>
                <div class="result-header">Финиш!</div>
                <div class="score-circle" style="border-color:#2ecc71; color:#2ecc71">
                    <span class="score-val">${score}</span><span class="score-label">Очков</span>
                </div>
                <div class="result-btns"><button class="primary-btn" onclick="app.renderTraining(document.getElementById('content-area'))">Дальше</button></div>
            </div>`;
    },

    // --- ЭКСПОРТ В EXCEL (CSV) ---
    async exportClassToCSV(classId, className) {
        try {
            // Запрашиваем свежие данные с сервера
            const res = await fetch(`${API}/teacher/dashboard/${this.user.id}`);
            const classes = await res.json();
            const targetClass = classes.find(c => c.class_id === classId);

            if (!targetClass || targetClass.students.length === 0) {
                alert('В этом классе пока нет учеников для экспорта.');
                return;
            }

            // Формируем содержимое CSV файла
            let csvContent = '\uFEFF'; // Спец. символ (BOM), чтобы русский язык нормально открывался в Excel
            csvContent += "Имя ученика;ID в системе;Пройдено уроков;Средний балл\n"; // Заголовки колонок

            targetClass.students.forEach(s => {
                let grade = s.average_grade ? parseFloat(s.average_grade).toFixed(1).replace('.', ',') : 'Нет оценок';
                // Формируем строку ученика (разделитель - точка с запятой)
                csvContent += `${s.name};${s.user_id};${s.lessons_done || 0};${grade}\n`;
            });

            // Создаем виртуальный файл и эмулируем клик для скачивания
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.setAttribute("href", url);
            link.setAttribute("download", `Успеваемость_Класс_${className}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

        } catch (e) {
            alert('Ошибка при формировании отчета: ' + e.message);
        }
    },


    fireConfetti() {
        const colors = ['#e74c3c', '#3498db', '#f1c40f', '#2ecc71'];
        for (let i = 0; i < 50; i++) {
            const c = document.createElement('div');
            c.className = 'confetti';
            c.style.left = Math.random() * 100 + 'vw';
            c.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
            c.style.animationDuration = (Math.random() * 2 + 2) + 's';
            document.body.appendChild(c);
            setTimeout(() => c.remove(), 4000);
        }
    }
};


// ==========================================
// ЛОГИКА МОБИЛЬНОГО МЕНЮ
// ==========================================
function toggleMobileMenu() {
    const sidebar = document.getElementById('sidebar');
    const btn = document.getElementById('burger-btn');

    sidebar.classList.toggle('active');

    // Меняем иконку (бургер <-> крестик)
    if (sidebar.classList.contains('active')) {
        btn.innerHTML = '<i class="fas fa-times"></i>'; // Крестик
    } else {
        btn.innerHTML = '<i class="fas fa-bars"></i>';  // Бургер
    }
}


// Авто-закрытие меню при клике на кнопку внутри него
document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const sidebar = document.getElementById('sidebar');
        // Если мы на мобильном (есть класс active), то закрываем
        if (sidebar.classList.contains('active')) {
            toggleMobileMenu();
        }
    });
});

document.addEventListener('DOMContentLoaded', () => auth.init());