# database.py
import sqlite3
import os
from datetime import datetime
from typing import Optional, List, Dict, Any
from loguru import logger

from config import MAX_CHAT_MESSAGES


class Database:
    def __init__(self, db_path: str = "app.db", max_messages=20):
        self.db_path = db_path
        self.conn: Optional[sqlite3.Connection] = None
        self.MAX_MESSAGES = max_messages

    def connect(self):
        """Установить соединение с базой данных"""
        self.conn = sqlite3.connect(self.db_path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row

    def close(self):
        """Закрыть соединение с базой данных"""
        if self.conn:
            self.conn.close()

    def init_tables(self):
        """Инициализировать таблицы в базе данных"""
        if not self.conn:
            self.connect()

        cursor = self.conn.cursor()

        # Создание таблицы Users
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS Users (
                uuid TEXT PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                is_admin BOOLEAN NOT NULL DEFAULT FALSE
            )
        ''')

        # Создание таблицы Messages
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS Messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                type TEXT NOT NULL,
                content TEXT NOT NULL,
                datetime TEXT NOT NULL,
                user_uuid TEXT,
                FOREIGN KEY (user_uuid) REFERENCES Users (uuid)
            )
        ''')

        # Создание таблицы VoiceRooms
        cursor.execute('''
            CREATE TABLE IF NOT EXISTS VoiceRooms (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL
            )
        ''')

        self.conn.commit()

    def add_admin_user(self, uuid: str, username: str):
        """Добавить администратора в таблицу Users"""
        if not self.conn:
            self.connect()

        cursor = self.conn.cursor()

        # Проверяем, существует ли уже пользователь
        cursor.execute('SELECT * FROM Users WHERE uuid = ?', (uuid,))
        existing_user = cursor.fetchone()

        if not existing_user:
            # Добавляем администратора
            cursor.execute(
                'INSERT INTO Users (uuid, username, is_admin) VALUES (?, ?, ?)',
                (uuid, username, True)
            )
            self.conn.commit()
            logger.info(f"Администратор {username} добавлен в базу данных")
        else:
            logger.info(f"Администратор {username} уже существует в базе данных")

    def add_user(self, uuid: str, username: str, is_admin: bool = False):
        """Добавить обычного пользователя в таблицу Users"""
        if not self.conn:
            self.connect()

        cursor = self.conn.cursor()

        # Проверяем, существует ли уже пользователь
        cursor.execute('SELECT * FROM Users WHERE uuid = ?', (uuid,))
        existing_user = cursor.fetchone()

        if not existing_user:
            # Добавляем пользователя
            cursor.execute(
                'INSERT INTO Users (uuid, username, is_admin) VALUES (?, ?, ?)',
                (uuid, username, is_admin)
            )
            self.conn.commit()
            logger.info(f"Пользователь {username} добавлен в базу данных")
            return True
        else:
            logger.info(f"Пользователь {username} уже существует в базе данных")
            return False

    def add_message(self, message_type: str, content: str, user_uuid: Optional[str] = None) -> int:
        """Добавить сообщение в таблицу Messages"""
        if not self.conn:
            self.connect()

        cursor = self.conn.cursor()

        # Добавляем новое сообщение
        datetime_str = datetime.now().isoformat()
        cursor.execute(
            'INSERT INTO Messages (type, content, datetime, user_uuid) VALUES (?, ?, ?, ?)',
            (message_type, content, datetime_str, user_uuid)
        )

        message_id = cursor.lastrowid
        self.conn.commit()

        # Проверяем лимит сообщений и удаляем старые при необходимости
        self._enforce_message_limit(message_type)

        return message_id

    def _enforce_message_limit(self, message_type: str):
        """Проверить и применить ограничение на количество сообщений"""
        if not self.conn:
            return

        cursor = self.conn.cursor()

        # Получаем общее количество сообщений
        cursor.execute('SELECT COUNT(*) as count FROM Messages')
        count = cursor.fetchone()['count']

        # Если превышен лимит, удаляем самые старые сообщения
        if count > self.MAX_MESSAGES:
            # Получаем ID самых старых сообщений, которые нужно удалить
            cursor.execute('''
                SELECT id, type, content FROM Messages 
                ORDER BY datetime ASC 
                LIMIT ?
            ''', (count - self.MAX_MESSAGES,))

            messages_to_delete = cursor.fetchall()

            for message in messages_to_delete:
                # Если это медиа-сообщение, удаляем файл
                if message['type'] == 'media':
                    file_path = message['content']
                    self._delete_media_file(file_path)

                # Удаляем запись из базы данных
                cursor.execute('DELETE FROM Messages WHERE id = ?', (message['id'],))

            self.conn.commit()
            logger.info(f"Удалено {len(messages_to_delete)} старых сообщений для соблюдения лимита")

    def _delete_media_file(self, file_path: str):
        """Удалить медиа файл с диска"""
        try:
            # Преобразуем относительный путь в абсолютный
            if file_path.startswith('/static/media/'):
                file_path = '.' + file_path
            elif file_path.startswith('./static/media/'):
                pass  # Уже правильный формат
            else:
                # Добавляем путь к папке static/media
                file_path = f'./static/media/{file_path}'

            if os.path.exists(file_path):
                os.remove(file_path)
                logger.info(f"Медиа файл удален: {file_path}")
        except Exception as e:
            logger.info(f"Ошибка при удалении медиа файла {file_path}: {e}")

    def get_user_by_uuid(self, uuid: str) -> Optional[Dict[str, Any]]:
        """Получить пользователя по UUID"""
        if not self.conn:
            self.connect()

        cursor = self.conn.cursor()
        cursor.execute('SELECT * FROM Users WHERE uuid = ?', (uuid,))
        row = cursor.fetchone()

        if row:
            return dict(row)
        return None

    def get_user_by_username(self, username: str) -> Optional[Dict[str, Any]]:
        """Получить пользователя по имени"""
        if not self.conn:
            self.connect()

        cursor = self.conn.cursor()
        cursor.execute('SELECT * FROM Users WHERE username = ?', (username,))
        row = cursor.fetchone()

        if row:
            return dict(row)
        return None

    def get_recent_messages(self, limit: int = 20) -> List[Dict[str, Any]]:
        """Получить последние сообщения"""
        if not self.conn:
            self.connect()

        cursor = self.conn.cursor()
        cursor.execute('''
            SELECT M.*, U.username 
            FROM Messages M 
            LEFT JOIN Users U ON M.user_uuid = U.uuid
            ORDER BY M.datetime DESC 
            LIMIT ?
        ''', (limit,))

        rows = cursor.fetchall()
        return [dict(row) for row in rows]

    def get_message_count(self) -> int:
        """Получить общее количество сообщений"""
        if not self.conn:
            self.connect()

        cursor = self.conn.cursor()
        cursor.execute('SELECT COUNT(*) as count FROM Messages')
        return cursor.fetchone()['count']

    def delete_user(self, uuid: str) -> bool:
        """Удалить пользователя по UUID"""
        if not self.conn:
            self.connect()

        cursor = self.conn.cursor()

        # Проверяем, существует ли пользователь
        cursor.execute('SELECT * FROM Users WHERE uuid = ?', (uuid,))
        user = cursor.fetchone()

        if not user:
            return False

        # Удаляем пользователя
        cursor.execute('DELETE FROM Users WHERE uuid = ?', (uuid,))
        self.conn.commit()

        logger.info(f"Пользователь {user['username']} удален из базы данных")
        return True

    def add_voice_room(self, room_name: str) -> bool:
        """Добавить голосовую комнату"""
        if not self.conn:
            self.connect()

        cursor = self.conn.cursor()

        try:
            cursor.execute('INSERT INTO VoiceRooms (name) VALUES (?)', (room_name,))
            self.conn.commit()
            logger.info(f"Комната '{room_name}' добавлена в базу данных")
            return True
        except sqlite3.IntegrityError:
            logger.info(f"Комната '{room_name}' уже существует")
            return False

    def get_voice_rooms(self) -> List[Dict[str, Any]]:
        """Получить список всех голосовых комнат"""
        if not self.conn:
            self.connect()

        cursor = self.conn.cursor()
        cursor.execute('SELECT id, name FROM VoiceRooms ORDER BY name')
        rows = cursor.fetchall()
        return [dict(row) for row in rows]

    def get_voice_room_by_name(self, room_name: str) -> Optional[Dict[str, Any]]:
        """Получить комнату по имени"""
        if not self.conn:
            self.connect()

        cursor = self.conn.cursor()
        cursor.execute('SELECT id, name FROM VoiceRooms WHERE name = ?', (room_name,))
        row = cursor.fetchone()

        if row:
            return dict(row)
        return None

    def voice_room_exists(self, room_name: str) -> bool:
        """Проверить, существует ли комната"""
        return self.get_voice_room_by_name(room_name) is not None

    def init_default_rooms(self):
        """Инициализировать комнаты по умолчанию"""
        if not self.conn:
            self.connect()

        # Добавляем комнату General, если ее нет
        if not self.voice_room_exists('General'):
            self.add_voice_room('General')
            logger.info("Комната 'General' добавлена по умолчанию")
        else:
            logger.info("Комната 'General' уже существует")


db = Database(max_messages=MAX_CHAT_MESSAGES)
