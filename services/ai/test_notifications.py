import sqlite3
import unittest
from datetime import datetime

import notifications


class NotificationTests(unittest.TestCase):
    def setUp(self):
        self.conn = sqlite3.connect(':memory:')
        self.conn.row_factory = sqlite3.Row
        self.addCleanup(self.conn.close)
        self.conn.execute("""CREATE TABLE todos(id TEXT PRIMARY KEY,title TEXT,customer TEXT,
            project TEXT,owner TEXT,due_date TEXT,status TEXT)""")
        notifications.migrate(self.conn)
        notifications.migrate(self.conn)
        self.conn.execute("INSERT INTO todos VALUES('one','发送报价','客户','项目','王总','2026-11-01','todo')")
        self.settings = {'systemNotifications': True, 'quietStart': '22:00', 'quietEnd': '08:00'}

    def listing(self, hour=9):
        return notifications.listing(self.conn, self.settings, datetime(2026, 11, 1, hour))

    def test_nine_am_persisted_dedup_and_delivery_separate_from_read(self):
        self.assertEqual(self.listing(8)['items'], [])
        result = self.listing()
        self.assertEqual(result['unreadCount'], 1)
        item = result['items'][0]
        self.assertTrue(item['deliver'])
        notifications.mark(self.conn, {'action': 'delivered', 'ids': [item['id']]})
        self.conn.commit()
        self.assertFalse(self.listing()['items'][0]['deliver'])
        self.assertEqual(self.listing()['unreadCount'], 1)
        notifications.mark(self.conn, {'action': 'read', 'ids': [item['id']]})
        self.assertEqual(self.listing()['unreadCount'], 0)
        self.assertEqual(len(self.listing(18)['items']), 1)
        restored = sqlite3.connect(':memory:')
        restored.row_factory = sqlite3.Row
        self.addCleanup(restored.close)
        self.conn.commit()
        self.conn.backup(restored)
        notifications.migrate(restored)
        self.assertEqual(notifications.listing(restored, self.settings)['unreadCount'], 0)

    def test_done_cancel_deleted_postponed_notifications_removed(self):
        self.listing()
        self.conn.execute("UPDATE todos SET due_date='2026-11-02'")
        self.assertEqual(self.listing()['items'], [])
        self.conn.execute("UPDATE todos SET due_date='2026-11-01',status='doing'")
        self.assertEqual(len(self.listing()['items']), 1)
        for status in ('done', 'cancelled'):
            self.conn.execute('UPDATE todos SET status=?', (status,))
            self.assertEqual(self.listing()['items'], [])
            self.conn.execute("UPDATE todos SET status='todo'")
            self.listing()
        self.conn.execute('DELETE FROM todos')
        self.assertEqual(self.listing()['items'], [])

    def test_quiet_hours_and_disabled_preserve_in_app_unread(self):
        self.assertFalse(self.listing(23)['items'][0]['deliver'])
        self.assertTrue(self.listing(9)['items'][0]['deliver'])
        self.settings['systemNotifications'] = False
        self.assertFalse(self.listing()['items'][0]['deliver'])
        self.assertEqual(self.listing()['unreadCount'], 1)
        self.settings.update(systemNotifications=True, quietStart='09:00', quietEnd='12:00')
        self.assertFalse(self.listing(11)['items'][0]['deliver'])
        self.assertTrue(self.listing(12)['items'][0]['deliver'])
        self.settings.update(quietStart='00:00', quietEnd='00:00')
        self.assertFalse(notifications.quiet_now(self.settings, datetime(2026, 11, 1, 0)))
        self.settings.update(quietStart='22:00', quietEnd='08:00')
        self.assertTrue(notifications.quiet_now(self.settings, datetime(2026, 11, 1, 2)))
        self.assertFalse(notifications.quiet_now(self.settings, datetime(2026, 11, 1, 8)))

    def test_read_all_and_invalid_actions(self):
        self.listing()
        with self.assertRaises(ValueError):
            notifications.mark(self.conn, {'action': 'remove', 'ids': ['one']})
        with self.assertRaises(ValueError):
            notifications.mark(self.conn, {'action': 'delivered', 'all': True})
        notifications.mark(self.conn, {'action': 'read', 'all': True})
        self.assertEqual(self.listing()['unreadCount'], 0)
        self.assertFalse(self.listing()['items'][0]['deliver'])


if __name__ == '__main__':
    unittest.main()
