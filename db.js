const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const path = require('path');


const dbPromise = open({

  filename: path.join(__dirname, 'data.sqlite'), 
  driver: sqlite3.Database
});

console.log("Попытка подключения к локальной БД...");
module.exports = dbPromise;