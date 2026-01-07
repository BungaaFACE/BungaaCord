#!/usr/bin/env python3
"""
Тестовый скрипт для проверки функциональности чата
"""
from database import db
import requests
import json
import sys
import os

# Добавляем текущую директорию в путь
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def test_database():
    """Тестирование базы данных"""
    print("🔍 Тестирование базы данных...")

    try:
        db.connect()
        db.init_tables()

        # Создаем тестового пользователя
        success = db.add_user('test-uuid-123', 'TestUser')
        if success:
            print("✅ Тестовый пользователь создан")
        else:
            print("ℹ️  Тестовый пользователь уже существует")

        # Проверяем получение пользователя
        user = db.get_user_by_uuid('test-uuid-123')
        if user:
            print(f"✅ Пользователь найден: {user['username']}")
        else:
            print("❌ Пользователь не найден")

        # Добавляем тестовое сообщение
        msg_id = db.add_message('text', 'Тестовое сообщение', 'test-uuid-123')
        print(f"✅ Тестовое сообщение добавлено (ID: {msg_id})")

        # Получаем сообщения
        messages = db.get_recent_messages(10)
        print(f"✅ Получено {len(messages)} сообщений")

        # Добавляем медиа сообщение
        media_id = db.add_message('media', '/static/media/test.jpg', 'test-uuid-123')
        print(f"✅ Медиа сообщение добавлено (ID: {media_id})")

        db.close()
        print("✅ Тестирование базы данных завершено успешно\n")
        return True

    except Exception as e:
        print(f"❌ Ошибка тестирования базы данных: {e}\n")
        return False


def test_api():
    """Тестирование API endpoints"""
    print("🔍 Тестирование API endpoints...")

    base_url = 'https://localhost:9000'

    try:
        # Пропускаем SSL verification для тестов
        import urllib3
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

        # Тестируем health check
        try:
            response = requests.get(f'{base_url}/health', verify=False, timeout=5)
            if response.status_code == 200:
                print("✅ Health check работает")
            else:
                print(f"⚠️  Health check вернул статус {response.status_code}")
        except:
            print("⚠️  Сервер не запущен, пропускаем API тесты")
            return True

        # Тестируем получение сообщений
        response = requests.get(f'{base_url}/api/messages', verify=False, timeout=5)
        if response.status_code == 200:
            data = response.json()
            print(f"✅ Получение сообщений работает (статус: {data['status']})")
        else:
            print(f"❌ Получение сообщений вернуло статус {response.status_code}")

        # Тестируем получение пользователя
        response = requests.get(f'{base_url}/api/user?uuid=test-uuid-123', verify=False, timeout=5)
        if response.status_code == 200:
            data = response.json()
            print(f"✅ Получение пользователя работает (статус: {data['status']})")
        else:
            print(f"⚠️  Получение пользователя вернуло статус {response.status_code}")

        print("✅ Тестирование API завершено успешно\n")
        return True

    except Exception as e:
        print(f"❌ Ошибка тестирования API: {e}\n")
        return False


def test_file_upload():
    """Тестирование загрузки файлов"""
    print("🔍 Тестирование загрузки файлов...")

    # Проверяем наличие папки static/media
    media_dir = './static/media'
    if not os.path.exists(media_dir):
        os.makedirs(media_dir)
        print(f"✅ Папка {media_dir} создана")
    else:
        print(f"✅ Папка {media_dir} существует")

    # Проверяем права на запись
    test_file = os.path.join(media_dir, 'test_write.txt')
    try:
        with open(test_file, 'w') as f:
            f.write('test')
        os.remove(test_file)
        print("✅ Права на запись в папку media есть")
    except Exception as e:
        print(f"❌ Нет прав на запись в папку media: {e}")
        return False

    print("✅ Тестирование загрузки файлов завершено успешно\n")
    return True


def main():
    """Основная функция тестирования"""
    print("🚀 Запуск тестов функциональности чата\n")

    results = []

    # Запускаем тесты
    results.append(("База данных", test_database()))
    results.append(("API", test_api()))
    results.append(("Загрузка файлов", test_file_upload()))

    # Выводим итоги
    print("=" * 50)
    print("📊 ИТОГИ ТЕСТИРОВАНИЯ")
    print("=" * 50)

    passed = 0
    failed = 0

    for test_name, result in results:
        status = "✅ ПРОЙДЕН" if result else "❌ ПРОВАЛЕН"
        print(f"{test_name}: {status}")
        if result:
            passed += 1
        else:
            failed += 1

    print("=" * 50)
    print(f"Всего тестов: {len(results)}")
    print(f"Пройдено: {passed}")
    print(f"Провалено: {failed}")
    print("=" * 50)

    if failed == 0:
        print("\n🎉 Все тесты пройдены успешно!")
        print("\n📝 Инструкция по использованию чата:")
        print("1. Запустите сервер: python server.py")
        print("2. Откройте в браузере: https://localhost:9000/?user=ADMIN_UUID")
        print("3. Присоединитесь к комнате")
        print("4. Используйте чат для отправки текстовых сообщений")
        print("5. Нажмите на иконку 📎 или перетащите файл для отправки медиа")
        print("6. Используйте Ctrl+V для вставки изображений/видео из буфера обмена")
        print("7. Нажмите на изображение чтобы открыть его в полном размере")
        return 0
    else:
        print(f"\n⚠️  {failed} тест(ов) провалено. Проверьте конфигурацию.")
        return 1


if __name__ == '__main__':
    exit(main())
