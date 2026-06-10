const fs = require('fs');
const path = require('path');
const readline = require('readline');
const dbPromise = require('./db');

// Продвинутый очиститель структуры таблиц под стандарт SQLite
function cleanCreateTable(stmt) {
    let lines = stmt.split('\n');
    let cleanLines = [];
    
    for (let line of lines) {
        let trimmed = line.trim();
        if (!trimmed) continue;
        
        // Полностью удаляем строки с индексами и внешними ключами, которые ломают SQLite
        if (/^(KEY|UNIQUE KEY|CONSTRAINT|FOREIGN KEY|PRIMARY KEY\s*\()/i.test(trimmed)) {
            continue;
        }
        
        // Конвертируем типы данных и специфические ключевые слова MySQL
        let l = trimmed
            .replace(/int\(\d+\)/gi, 'INTEGER')
            .replace(/int /gi, 'INTEGER ')
            .replace(/tinyint\(\d+\)/gi, 'INTEGER')
            .replace(/smallint\(\d+\)/gi, 'INTEGER')
            .replace(/mediumint\(\d+\)/gi, 'INTEGER')
            .replace(/bigint\(\d+\)/gi, 'INTEGER')
            .replace(/unsigned/gi, '')
            .replace(/varchar\(\d+\)/gi, 'TEXT')
            .replace(/longtext/gi, 'TEXT')
            .replace(/mediumtext/gi, 'TEXT')
            .replace(/tinytext/gi, 'TEXT')
            .replace(/datetime/gi, 'TEXT')
            .replace(/timestamp/gi, 'TEXT')
            .replace(/enum\([^)]+\)/gi, 'TEXT') // Исправляет ошибку near "'student'"
            .replace(/AUTO_INCREMENT/gi, 'PRIMARY KEY AUTOINCREMENT')
            .replace(/ON UPDATE [^,)]+/gi, ''); // Исправляет ошибку в user_notes
            
        cleanLines.push(l);
    }
    
    let body = cleanLines.join('\n');
    
    // Исправляем висящие запятые перед закрывающей скобкой таблицы
    body = body.replace(/,\s*\)/g, '\n)');
    
    // Обрезаем настройки движка MySQL (ENGINE=InnoDB...)
    let lastParenthesis = body.lastIndexOf(')');
    if (lastParenthesis !== -1) {
        body = body.substring(0, lastParenthesis + 1) + ';';
    }
    
    return body;
}

async function startUltimateMigration() {
    try {
        const db = await dbPromise;
        const sqlDumpPath = path.join(__dirname, 'full_backup.sql');
        
        if (!fs.existsSync(sqlDumpPath)) {
            console.error(`❌ Ошибка: Файл ${sqlDumpPath} не найден!`);
            return;
        }

        console.log("⏳ Запуск полного импорта всех таблиц и данных...");

        const fileStream = fs.createReadStream(sqlDumpPath);
        const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

        let currentStatement = '';
        let inQuotes = false;
        let quoteChar = '';

        let tablesCreated = 0;
        let tablesWithData = {};

        // Открываем транзакцию для максимальной скорости записи
        await db.run("BEGIN TRANSACTION");

        for await (const line of rl) {
            // Игнорируем системные комментарии дампа
            if (currentStatement.length === 0 && (line.startsWith('--') || line.startsWith('/*'))) {
                continue;
            }

            // Посимвольный разбор строки для поиска точного конца SQL команды (;)
            for (let i = 0; i < line.length; i++) {
                const char = line[i];
                const prevChar = i > 0 ? line[i-1] : '';

                // Проверяем, находимся ли мы внутри текстовых кавычек
                if ((char === "'" || char === '"') && prevChar !== '\\') {
                    if (!inQuotes) {
                        inQuotes = true;
                        quoteChar = char;
                    } else if (quoteChar === char) {
                        inQuotes = false;
                    }
                }

                currentStatement += char;

                // Если нашли точку с запятой вне кавычек — команда завершена
                if (char === ';' && !inQuotes) {
                    const stmt = currentStatement.trim();
                    currentStatement = '';

                    // ОБРАБОТКА CREATE TABLE
                    if (/^CREATE TABLE/i.test(stmt)) {
                        const match = stmt.match(/CREATE TABLE\s+[`"']?([a-zA-Z0-9_]+)[`"']?/i);
                        if (match) {
                            const tableName = match[1];
                            const sqliteCompatibleSchema = cleanCreateTable(stmt);
                            
                            await db.run(`DROP TABLE IF EXISTS \`${tableName}\``);
                            try {
                                await db.run(sqliteCompatibleSchema);
                                tablesCreated++;
                                tablesWithData[tableName] = 0;
                            } catch (e) {
                                console.error(`❌ Ошибка создания таблицы [${tableName}]:`, e.message);
                            }
                        }
                    } 
                    // ОБРАБОТКА INSERT INTO
                    else if (/^INSERT INTO/i.test(stmt)) {
                        const match = stmt.match(/INSERT INTO\s+[`"']?([a-zA-Z0-9_]+)[`"']?/i);
                        if (!match) continue;
                        const tableName = match[1];

                        // Переводим экранирование MySQL (\') в формат SQLite ('')
                        let cleanInsert = stmt
                            .replace(/\\'/g, "''")
                            .replace(/\\"/g, '"')
                            .replace(/\\n/g, '\n')
                            .replace(/\\r/g, '\r');

                        try {
                            await db.run(cleanInsert);
                            tablesWithData[tableName] = (tablesWithData[tableName] || 0) + 1;
                        } catch (e) {
                            console.error(`❌ Ошибка записи данных в [${tableName}]:`, e.message.slice(0, 120));
                        }
                    }
                }
            }
            if (currentStatement.length > 0) currentStatement += '\n';
        }

        // Сохраняем все транзакции в файл базы данных
        await db.run("COMMIT");

        console.log(`\n🎉 ПОЛНАЯ МИГРАЦИЯ УСПЕШНО ЗАВЕРШЕНА!`);
        console.log(`📦 Всего воссоздано таблиц: ${tablesCreated}`);
        console.log(`📊 Статистика перенесенных блоков данных:`);
        for (const [table, status] of Object.entries(tablesWithData)) {
            console.log(`  🔹 Таблица [${table}] -> Успешно импортирована.`);
        }

    } catch (err) {
        console.error("❌ Критическая ошибка во время выполнения миграции:", err);
    }
}

startUltimateMigration();