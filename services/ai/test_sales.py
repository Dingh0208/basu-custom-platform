"""Run with: python -m unittest discover -s services/ai -p test_sales.py -v"""

import io
import json
import os
import sqlite3
import tempfile
import threading
import unittest
from email.message import EmailMessage
from unittest.mock import patch
import urllib.error
import urllib.request
from urllib.parse import quote
import zipfile
from datetime import date, datetime, timedelta
from pathlib import Path

# Never load or mutate the user's application database.
_sandbox = tempfile.TemporaryDirectory(prefix="clienthub-sales-tests-")
os.environ["CLIENTHUB_DATA_DIR"] = _sandbox.name
import main
import sales
import clarifications
import document_ingest
from docx import Document
from openpyxl import Workbook
from pypdf import PdfWriter


class SalesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        main.init_db()
        cls.server = main.ThreadingHTTPServer(("127.0.0.1", 0), main.Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()
        _sandbox.cleanup()

    def setUp(self):
        main.init_db()
        with main.db() as conn:
            for table in ("clarification_answers", "clarification_evidence", "clarification_questions", "clarification_sources", "clarification_records", "todos", "requirements", "projects", "archived_projects", "customers", "imports", "chats", "tasks", "customer_match_audits"):
                conn.execute(f"DELETE FROM {table}")
            conn.execute("INSERT OR IGNORE INTO transcripts(id,title,file_name,file_size,duration,imported_at,customer,company,project,source,segments_json,summary_json) VALUES ('tr-001','测试通话','test.m4a','1 MB',60,'2026-10-20','测试客户','测试公司','测试项目','audio','[]','{}')")
            conn.execute("UPDATE transcripts SET customer='测试客户',project='测试项目',imported_at='2026-10-20 10:00',summary_json=?",
                         (json.dumps({"needs": "统一检索需求", "oneLine": "销售测试", "nextActions": "发送报价", "objections": "预算需要审批"}, ensure_ascii=False),))
        main.update_customer("测试客户", {"owner": "负责人甲", "company": "统一检索公司"})
        self.project = main.create_project("测试客户", {"name": "测试项目", "owner": "负责人甲"})
        self.deadline = (date.today() - timedelta(days=1)).isoformat()

    def request(self, path, method="GET", data=None):
        body = json.dumps(data).encode() if data is not None else None
        request = urllib.request.Request(self.base + path, data=body, method=method, headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                return response.status, json.loads(response.read())
        except urllib.error.HTTPError as exc:
            return exc.code, json.loads(exc.read())

    def raw_request(self, path, method="GET", data=None):
        body = json.dumps(data).encode() if data is not None else None
        request = urllib.request.Request(self.base + path, data=body, method=method, headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                return response.status, dict(response.headers), response.read()
        except urllib.error.HTTPError as exc:
            return exc.code, dict(exc.headers), exc.read()

    def requirement(self, title="统一检索需求", **extra):
        return main.create_requirement("测试客户", {"project": "测试项目", "title": title, "owner": "负责人甲", "dueDate": self.deadline, "sourceType": "audio", "sourceId": "tr-001", "sourceQuote": "原始需求证据", **extra})

    def todo(self, **extra):
        with main.db() as conn:
            return sales.save_todo(conn, {"customer": "测试客户", "project": "测试项目", "title": "发送报价", "owner": "负责人甲", "dueDate": self.deadline, "sourceId": "tr-001", "sourceType": "audio", **extra})

    def import_record(self, record_id, status="inbox", customer="待归档"):
        with main.db() as conn:
            conn.execute("INSERT INTO imports(id,file_name,type,size,customer,project,status,progress,imported_at) VALUES (?,?, 'PDF','1 KB',?,'—',?,100,'2026-10-20 10:00')", (record_id, record_id + '.pdf', customer, status))

    def test_migration_keeps_legacy_data_and_is_idempotent(self):
        conn = sqlite3.connect(":memory:")
        conn.row_factory = sqlite3.Row
        conn.executescript("CREATE TABLE imports(id TEXT); INSERT INTO imports VALUES ('legacy'); CREATE TABLE requirements(id TEXT);")
        sales.migrate(conn)
        sales.migrate(conn)
        self.assertEqual(conn.execute("SELECT id,owner FROM imports").fetchone()["id"], "legacy")
        self.assertEqual(conn.execute("SELECT owner FROM imports").fetchone()[0], "")
        conn.close()

    def test_attachment_migration_adds_transcript_column_once(self):
        conn = sqlite3.connect(':memory:')
        conn.row_factory = sqlite3.Row
        conn.executescript("CREATE TABLE chats(id TEXT); CREATE TABLE transcripts(id TEXT);")
        main.migrate_ingest(conn)
        main.migrate_ingest(conn)
        for table in ('chats', 'transcripts'):
            columns = {row['name'] for row in conn.execute(f'PRAGMA table_info({table})')}
            self.assertIn('attachments_json', columns)
        conn.close()

    def test_requirement_todo_trace_and_completion_persist(self):
        req = self.requirement()
        status, todo = self.request('/api/todos', 'POST', {"requirementId": req["id"], "title": req["title"]})
        self.assertEqual(status, 201)
        self.assertEqual((todo['sourceId'], todo['sourceQuote'], todo['owner'], todo['dueDate']), ('tr-001', '原始需求证据', '负责人甲', self.deadline))
        status, completed = self.request('/api/todos/' + todo['id'], 'PATCH', {"status": "done"})
        self.assertEqual(status, 200)
        self.assertIsNotNone(completed['completedAt'])
        self.assertEqual(self.request('/api/todos')[1][0]['status'], 'done')
        # Completing a follow-up is independent from implementing a requirement.
        self.assertEqual(main.list_requirements('测试客户')[0]['status'], '待确认')

    def test_duplicate_todo_does_not_create_second_record(self):
        self.assertEqual(self.todo()['id'], self.todo()['id'])
        self.assertEqual(len(self.request('/api/todos')[1]), 1)

    def test_validation_rejects_invalid_or_cross_customer_links(self):
        for extra in ({'dueDate': 'next week'}, {'owner': ''}, {'customer': '不存在'}, {'project': '其他客户的项目'}, {'sourceId': 'missing'}, {'status': 'invalid'}):
            payload = {'customer': '测试客户', 'project': '测试项目', 'title': '测试', 'owner': '甲', 'dueDate': self.deadline, **extra}
            self.assertEqual(self.request('/api/todos', 'POST', payload)[0], 400)

    def test_archive_is_atomic_and_updates_source_requirements(self):
        self.import_record('pending', 'done')
        self.assertEqual(main.dashboard_summary()['stats']['inbox'], 1)
        with main.db() as conn:
            conn.execute("UPDATE imports SET transcript_id='tr-001' WHERE id='pending'")
            conn.execute("UPDATE transcripts SET customer='待归档',project='—' WHERE id='tr-001'")
        main.create_requirement('待归档', {'title': '待归档需求', 'sourceId': 'tr-001'})
        payload = {'ids': ['pending', 'missing'], 'customer': '测试客户', 'project': '测试项目', 'owner': '负责人乙'}
        self.assertEqual(self.request('/api/imports/archive', 'POST', payload)[0], 400)
        with main.db() as conn:
            self.assertEqual(conn.execute("SELECT customer FROM imports WHERE id='pending'").fetchone()[0], '待归档')
        payload['ids'] = ['pending']
        self.assertEqual(self.request('/api/imports/archive', 'POST', payload)[0], 200)
        req = main.list_requirements('测试客户')[0]
        self.assertEqual((req['project'], req['owner']), ('测试项目', '负责人乙'))
        self.assertEqual(self.request('/api/transcripts/tr-001')[1]['customer'], '测试客户')
        self.assertEqual(main.dashboard_summary()['stats']['inbox'], 0)

    def test_archive_rejects_processing_and_wrong_project(self):
        self.import_record('pending', 'processing')
        payload = {'ids': ['pending'], 'customer': '测试客户', 'project': '测试项目', 'owner': '甲'}
        self.assertEqual(self.request('/api/imports/archive', 'POST', payload)[0], 400)
        payload['project'] = '不存在'
        self.assertEqual(self.request('/api/imports/archive', 'POST', payload)[0], 400)

    def test_archive_shared_source_requires_all_affected_imports(self):
        for record_id in ('pending-a', 'pending-b'):
            self.import_record(record_id)
        with main.db() as conn:
            conn.execute("UPDATE imports SET transcript_id='tr-001'")
        payload = {'ids': ['pending-a'], 'customer': '测试客户', 'project': '测试项目', 'owner': '甲'}
        self.assertEqual(self.request('/api/imports/archive', 'POST', payload)[0], 400)
        payload['ids'].append('pending-b')
        self.assertEqual(self.request('/api/imports/archive', 'POST', payload)[0], 200)

    def test_rename_customer_and_project_preserves_todo(self):
        req = self.requirement()
        todo = self.todo(requirementId=req['id'])
        main.update_customer('测试客户', {'name': '新客户名'})
        main.update_project(self.project['id'], {'name': '新项目名'})
        saved = self.request('/api/todos')[1][0]
        self.assertEqual((saved['customer'], saved['project'], saved['id']), ('新客户名', '新项目名', todo['id']))
        main.update_requirement(req['id'], {'owner': '新负责人', 'dueDate': '2030-01-01'})
        saved = self.request('/api/todos')[1][0]
        self.assertEqual((saved['owner'], saved['dueDate']), ('新负责人', '2030-01-01'))

    def test_merge_requirement_rebinds_and_delete_preserves_todo(self):
        first, second = self.requirement('需求一', sourceType='manual', sourceId=''), self.requirement('需求二')
        self.todo(requirementId=second['id'])
        main.merge_requirements(first['id'], [second['id']])
        todo = self.request('/api/todos')[1][0]
        self.assertEqual(todo['requirementId'], first['id'])
        completed = self.request('/api/todos/' + todo['id'], 'PATCH', {'status': 'done'})[1]
        self.assertEqual(completed['sourceId'], 'tr-001')
        main.delete_requirement(first['id'])
        todo = self.request('/api/todos')[1][0]
        self.assertEqual(todo['requirementId'], '')
        self.assertEqual(todo['sourceId'], 'tr-001')

    def test_requirement_description_edit_preserves_todo_assignment(self):
        req = self.requirement()
        self.todo(requirementId=req['id'], owner='负责执行的人', dueDate='2030-01-01')
        main.update_requirement(req['id'], {'description': '补充说明'})
        saved = self.request('/api/todos')[1][0]
        self.assertEqual((saved['owner'], saved['dueDate']), ('负责执行的人', '2030-01-01'))

    def test_project_and_customer_delete_do_not_leave_orphans(self):
        self.todo()
        main.delete_project(self.project['id'])
        self.assertEqual(self.request('/api/todos')[1][0]['project'], '—')
        main.delete_customer('测试客户')
        self.assertEqual(self.request('/api/todos')[1], [])

    def test_delete_customer_removes_projects_and_does_not_reseed_on_restart(self):
        self.requirement()
        self.todo()
        self.import_record('owned', 'done', '测试客户')
        with main.db() as conn:
            conn.execute("INSERT INTO customer_match_audits(id,import_id,method,created_at) VALUES ('match-owned','owned','manual','2026-10-30')")
        result = main.delete_customer('测试客户')
        self.assertEqual(result['projects'], 1)
        self.assertEqual(main.list_projects('测试客户'), [])
        self.assertEqual([item['id'] for item in main.list_archived_projects()], [self.project['id']])
        main.init_db()
        main.backfill_requirements()
        self.assertEqual(main.list_all_projects(), [])
        self.assertEqual(main.list_customers(), [])
        with main.db() as conn:
            for table in ('imports', 'transcripts', 'requirements', 'todos', 'customer_match_audits'):
                self.assertEqual(conn.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0], 0)

    def test_restore_archived_project_restores_customer_profile_without_deleted_records(self):
        self.requirement()
        self.todo()
        self.import_record('owned', 'done', '测试客户')
        self.assertEqual(self.request('/api/customers/%s' % quote('测试客户'), 'DELETE')[0], 200)
        status, archived = self.request('/api/projects?archived=true')
        self.assertEqual(status, 200)
        self.assertEqual(len(archived), 1)
        self.assertEqual(archived[0]['customerCompany'], '统一检索公司')
        self.assertEqual(self.request('/api/projects')[1], [])
        backup, _ = main.create_backup_archive()
        with main.db() as conn:
            conn.execute('DELETE FROM archived_projects')
        main.restore_backup_archive(backup)
        self.assertEqual(main.list_archived_projects()[0]['id'], self.project['id'])
        status, restored = self.request('/api/projects/%s/restore' % self.project['id'], 'POST')
        self.assertEqual(status, 200)
        self.assertEqual(restored['restored'], self.project['id'])
        self.assertEqual(main.get_customer('测试客户')['company'], '统一检索公司')
        self.assertEqual(main.list_all_projects()[0]['id'], self.project['id'])
        self.assertEqual(main.list_archived_projects(), [])
        self.assertEqual(self.request('/api/projects/%s/restore' % self.project['id'], 'POST')[0], 404)
        self.assertEqual(self.request('/api/todos')[1], [])
        self.assertEqual(self.request('/api/customers/%s/requirements' % quote('测试客户'))[1], [])

    def test_restore_archived_project_preserves_existing_customer_and_rejects_name_conflict(self):
        main.delete_customer('测试客户')
        main.update_customer('测试客户', {'company': '新公司'})
        conflict = main.create_project('测试客户', {'name': '测试项目'})
        self.assertEqual(self.request('/api/projects/%s/restore' % self.project['id'], 'POST')[0], 409)
        self.assertEqual(main.get_customer('测试客户')['company'], '新公司')
        self.assertEqual(main.list_archived_projects()[0]['id'], self.project['id'])
        main.delete_project(conflict['id'])
        self.assertEqual(self.request('/api/projects/%s/restore' % self.project['id'], 'POST')[0], 200)
        self.assertEqual(main.get_customer('测试客户')['company'], '新公司')

    def test_delete_customer_archives_project_referenced_only_by_import(self):
        self.import_record('unlisted', 'done', '测试客户')
        with main.db() as conn:
            conn.execute("UPDATE imports SET project='导入项目' WHERE id='unlisted'")
            self.assertIsNone(conn.execute("SELECT id FROM projects WHERE name='导入项目'").fetchone())
        result = main.delete_customer('测试客户')
        self.assertEqual(result['projects'], 2)
        self.assertEqual({project['name'] for project in main.list_archived_projects()}, {'测试项目', '导入项目'})

    def test_notification_settings_api_and_backup_restore(self):
        import notifications
        original = main.get_app_settings()
        try:
            self.assertEqual(self.request('/api/settings/app', 'POST', {'quietStart': '25:00'})[0], 400)
            self.assertEqual(self.request('/api/settings/app', 'POST', {'systemNotifications': 'false'})[0], 400)
            self.assertEqual(self.request('/api/settings/app', 'POST', {'systemNotifications': True, 'quietStart': '00:00', 'quietEnd': '00:00'})[0], 200)
            todo = self.todo()
            with patch.object(notifications, 'datetime') as clock:
                clock.now.return_value = datetime.now().replace(hour=12)
                status, result = self.request('/api/notifications')
                self.assertEqual(status, 200)
                self.assertEqual(result['unreadCount'], 1)
                item = result['items'][0]
                self.assertEqual(item['todoId'], todo['id'])
                self.assertTrue(item['deliver'])
                self.assertEqual(self.request('/api/notifications', 'POST', {'action': 'delivered', 'ids': [item['id']]})[0], 200)
                self.assertEqual(self.request('/api/notifications', 'POST', {'action': 'read', 'all': True})[0], 200)
                archive, _ = main.create_backup_archive()
                with main.db() as conn:
                    conn.execute('DELETE FROM notifications')
                main.restore_backup_archive(archive)
                restored = self.request('/api/notifications')[1]
                self.assertEqual(restored['unreadCount'], 0)
                self.assertTrue(restored['items'][0]['delivered'])
                self.assertEqual(self.request('/api/notifications', 'POST', {'action': 'unsupported'})[0], 400)
        finally:
            main.save_app_settings(original)

    def test_profile_is_validated_and_persistent(self):
        with main.db() as conn:
            conn.execute("DELETE FROM settings WHERE key LIKE 'profile.%'")
        self.assertEqual(self.request('/api/profile')[1]['name'], '王总')
        self.assertEqual(self.request('/api/profile', 'POST', {'name': ' '})[0], 400)
        self.assertEqual(self.request('/api/profile', 'POST', {'name': '李明', 'phone': []})[0], 400)
        payload = {'name': '李明', 'role': '销售经理', 'company': '示例公司', 'phone': '13800000000', 'email': 'li@example.com'}
        self.assertEqual(self.request('/api/profile', 'POST', payload), (200, payload))
        main.init_db()
        self.assertEqual(self.request('/api/profile')[1], payload)

    def test_sales_endpoints_are_available_before_any_todos_exist(self):
        from urllib.parse import quote
        self.assertEqual(self.request('/api/todos'), (200, []))
        status, followup = self.request('/api/customers/' + quote('测试客户') + '/followup')
        self.assertEqual(status, 200)
        self.assertEqual(followup['todos'], [])
        metrics_status, metrics = self.request('/api/metrics?days=7')
        self.assertEqual(metrics_status, 200)
        self.assertIn('importsSuccessRate', metrics)
        dashboard_status, dashboard = self.request('/api/dashboard')
        self.assertEqual(dashboard_status, 200)
        self.assertIn('metrics', dashboard)
        self.assertGreaterEqual(self.request('/api/health')[1]['apiRevision'], 14)

    def test_wechat_engine_start_reports_repair_steps_when_backend_is_missing(self):
        with patch.object(main.wechat_engine, 'ensure_engine', side_effect=RuntimeError('未找到内置微信引擎 services/wechat-engine/wechat-backend.exe')):
            status, result = self.request('/api/wechat/start', 'POST', {})
        self.assertEqual(status, 503)
        self.assertEqual(result['status'], 'failed')
        self.assertTrue(result['logPath'].endswith('clienthub-wechat-engine.log'))
        self.assertTrue(any('覆盖安装' in step for step in result['repairSteps']))

    def test_wechat_engine_start_returns_health_after_launch(self):
        with patch.object(main.wechat_engine, 'ensure_engine', return_value={'available': True, 'started': True, 'port': 10393}):
            status, result = self.request('/api/wechat/start', 'POST', {})
        self.assertEqual(status, 200)
        self.assertEqual((result['status'], result['available'], result['port']), ('ok', True, 10393))

    def test_deleting_one_shared_import_keeps_other_source_todos(self):
        for record_id in ('audio-a', 'audio-b'):
            self.import_record(record_id, 'done', '测试客户')
        with main.db() as conn:
            conn.execute("UPDATE imports SET transcript_id='tr-001'")
        self.todo(requirementId=self.requirement()['id'])
        main.delete_import('audio-a')
        self.assertEqual(len(self.request('/api/todos')[1]), 1)
        main.delete_import('audio-b')
        self.assertEqual(self.request('/api/todos')[1], [])

    def test_customer_merge_preserves_project_and_todo_links(self):
        self.todo(requirementId=self.requirement()['id'])
        main.update_customer('目标客户', {})
        main.create_project('目标客户', {'name': '测试项目'})
        main.merge_customers('测试客户', '目标客户')
        todo = self.request('/api/todos')[1][0]
        self.assertEqual(todo['customer'], '目标客户')
        self.assertEqual(main.list_requirements('目标客户')[0]['id'], todo['requirementId'])
        self.assertEqual(self.request('/api/todos/' + todo['id'], 'PATCH', {'status': 'done'})[0], 200)
        with main.db() as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM projects WHERE customer='目标客户' AND name='测试项目'").fetchone()[0], 1)

    def test_followup_tracks_due_risks_and_hides_confirmed_suggestions(self):
        with main.db() as conn:
            data = sales.followup(conn, '测试客户')
        self.assertEqual(data['suggestions'][0]['title'], '发送报价')
        self.assertEqual(data['risks'][0]['text'], '预算需要审批')
        self.todo()
        with main.db() as conn:
            data = sales.followup(conn, '测试客户')
        self.assertEqual(data['overdue'], 1)
        self.assertEqual(data['suggestions'], [])
        self.assertEqual(data['lastContactAt'], '2026-10-20')

    def test_followup_recognizes_import_and_transcript_as_same_source(self):
        self.import_record('audio-import', 'done', '测试客户')
        with main.db() as conn:
            conn.execute("UPDATE imports SET transcript_id='tr-001' WHERE id='audio-import'")
        req = self.requirement(title='发送报价', sourceId='audio-import')
        self.todo(requirementId=req['id'])
        with main.db() as conn:
            self.assertEqual(sales.followup(conn, '测试客户')['suggestions'], [])

    def test_chat_role_change_moves_linked_sales_records(self):
        with main.db() as conn:
            conn.execute("INSERT INTO chats(id,title,file_name,customer,project,imported_at,participants_json,messages_json,analysis_json,status,message_count) VALUES ('chat-test','聊天','chat.txt','测试客户','测试项目','2026-10-30',?,'[]','{}','done',1)",
                         (json.dumps([{'name': '测试客户', 'role': 'customer'}, {'name': '新客户', 'role': 'me'}]),))
        req = self.requirement(sourceType='chat', sourceId='chat-test')
        self.todo(requirementId=req['id'])
        main.update_chat_participants('chat-test', [{'name': '测试客户', 'role': 'me'}, {'name': '新客户', 'role': 'customer'}])
        self.assertEqual(main.list_requirements('新客户')[0]['id'], req['id'])
        saved = self.request('/api/todos')[1][0]
        self.assertEqual(saved['customer'], '新客户')
        self.assertEqual(self.request('/api/todos/' + saved['id'], 'PATCH', {'status': 'done'})[0], 200)

    def test_followup_prefers_chat_date_over_later_import_date(self):
        with main.db() as conn:
            conn.execute("INSERT INTO chats(id,title,file_name,customer,project,imported_at,ended_at,participants_json,messages_json,analysis_json,status,message_count) VALUES ('chat-test','聊天','chat.txt','测试客户','测试项目','2026-10-30','2026-10-21 14:00','[]','[]','{}','done',1)")
            self.assertEqual(sales.followup(conn, '测试客户')['lastContactAt'], '2026-10-21')

    def test_search_five_entities_and_no_stale_results(self):
        self.requirement()
        main.update_project(self.project['id'], {'description': '统一检索方案'})
        with main.db() as conn:
            conn.execute("INSERT INTO chats(id,title,file_name,customer,project,imported_at,participants_json,messages_json,analysis_json,status,message_count) VALUES ('chat-test','聊天','chat.txt','测试客户','测试项目','2026-10-20','[]',?,'{}','done',1)", (json.dumps([{'content': '统一检索聊天'}], ensure_ascii=False),))
            result = sales.search(conn, '统一检索')
            literal = sales.search(conn, '%')
        self.assertEqual({r['kind'] for r in result['results']}, {'customer', 'project', 'requirement', 'chat', 'transcript'})
        self.assertEqual(literal['results'], [])
        main.delete_requirement(main.list_requirements('测试客户')[0]['id'])
        with main.db() as conn:
            self.assertEqual(sales.search(conn, '统一检索')['counts']['requirement'], 0)

    def test_summary_patch_is_persistent_and_validated(self):
        self.assertEqual(self.request('/api/transcripts/tr-001/summary', 'PATCH', {'summary': {'needs': []}})[0], 400)
        self.assertEqual(self.request('/api/transcripts/tr-001/summary', 'PATCH', {'summary': {'oneLine': '修改后的摘要'}})[0], 200)
        summary = self.request('/api/transcripts/tr-001')[1]['summary']
        self.assertEqual(summary['oneLine'], '修改后的摘要')
        self.assertEqual(summary['needs'], '统一检索需求')

    def test_search_caps_results_but_counts_all_matches(self):
        for number in range(25):
            self.requirement(title=f'报价跟进 {number}')
        with main.db() as conn:
            result = sales.search(conn, '报价跟进')
        self.assertEqual(result['counts']['requirement'], 25)
        self.assertEqual(len(result['results']), 20)

    def test_product_metrics_report_rates_latency_and_unknown_samples(self):
        anchor = datetime(2026, 10, 31, 12, 0, 0)
        self.import_record('metric-done', 'done', '测试客户')
        self.import_record('metric-failed', 'failed', '测试客户')
        with main.db() as conn:
            conn.execute("UPDATE imports SET imported_at='2026-10-30 09:00' WHERE id IN ('metric-done','metric-failed')")
            conn.execute("UPDATE transcripts SET imported_at='2026-10-29 09:00' WHERE id='tr-001'")
            conn.executemany(
                "INSERT INTO tasks(id,kind,status,created_at,updated_at,finished_at) VALUES (?,?,?,?,?,?)",
                [
                    ('metric-task-ok', 'import_real', 'succeeded', '2026-10-30 10:00:00', '2026-10-30 10:01:00', '2026-10-30 10:01:00'),
                    ('metric-task-fail', 'import_document', 'failed', '2026-10-30 10:00:00', '2026-10-30 10:10:00', '2026-10-30 10:10:00'),
                ],
            )
            conn.execute("INSERT INTO customer_match_audits(id,import_id,suggested_customer,confirmed_customer,method,is_correct,created_at,confirmed_at) VALUES ('match-ok','metric-done','测试客户','测试客户','auto',1,'2026-10-30','2026-10-30')")
            conn.execute("INSERT INTO customer_match_audits(id,import_id,suggested_customer,confirmed_customer,method,is_correct,created_at,confirmed_at) VALUES ('match-bad','metric-failed','错误客户','测试客户','auto',0,'2026-10-30','2026-10-30')")
        self.requirement(title='已确认需求', status='已确认')
        todo = self.todo()
        with main.db() as conn:
            conn.execute("UPDATE todos SET created_at='2026-10-30 09:00' WHERE id=?", (todo['id'],))
            report = sales.metrics(conn, days=7, now=anchor)
        self.assertEqual(report['importsSuccessRate']['value'], 0.5)
        self.assertEqual(report['parseCompletionRate']['value'], 0.5)
        self.assertEqual(report['parseP95Seconds']['value'], 600.0)
        self.assertEqual(report['customerMatchAccuracy']['value'], 0.5)
        self.assertEqual(report['requirementEffectiveness']['value'], 1.0)
        self.assertEqual(report['nextActionLatencyMinutes']['value'], 1440.0)
        self.assertEqual(report['weeklyActiveCustomers']['value'], 1)
        self.assertEqual(report['weeklyActiveProjects']['value'], 1)

    def test_metrics_leave_unmeasured_accuracy_as_null(self):
        with main.db() as conn:
            report = sales.metrics(conn, days=7, now=datetime(2026, 10, 31, 12, 0, 0))
        self.assertIsNone(report['customerMatchAccuracy']['value'])
        self.assertFalse(report['customerMatchAccuracy']['available'])

    def test_backup_round_trip_includes_sales_todos(self):
        todo = self.todo()
        archive, _ = main.create_backup_archive()
        with zipfile.ZipFile(io.BytesIO(archive)) as zipped:
            self.assertIn('clienthub.db', zipped.namelist())
        with main.db() as conn:
            conn.execute('DELETE FROM todos')
        main.restore_backup_archive(archive)
        self.assertEqual(self.request('/api/todos')[1][0]['id'], todo['id'])

    def test_document_parsers_extract_office_text_and_eml_attachments(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            docx_path = root / 'brief.docx'
            document = Document()
            document.add_paragraph('Document body')
            document.save(docx_path)
            self.assertIn('Document body', document_ingest.extract(docx_path)[0])

            xlsx_path = root / 'brief.xlsx'
            workbook = Workbook()
            workbook.active.title = 'Pipeline'
            workbook.active.append(['客户', '下次跟进'])
            workbook.active.append(['新客户', '周五'])
            workbook.save(xlsx_path)
            self.assertIn('Pipeline', document_ingest.extract(xlsx_path)[0])
            self.assertIn('新客户', document_ingest.extract(xlsx_path)[0])

            mail = EmailMessage()
            mail['From'] = 'sender@example.test'
            mail['To'] = 'sales@example.test'
            mail['Subject'] = 'Follow up'
            mail.set_content('Please review the attached plan.')
            mail.add_attachment(docx_path.read_bytes(), maintype='application', subtype='vnd.openxmlformats-officedocument.wordprocessingml.document', filename='plan.docx')
            eml_path = root / 'follow-up.eml'
            eml_path.write_bytes(mail.as_bytes())
            text, attachments = document_ingest.extract(eml_path)
            self.assertIn('Please review the attached plan.', text)
            self.assertEqual(attachments[0][0], 'plan.docx')
            self.assertEqual(attachments[0][1], docx_path.read_bytes())

            from pypdf import PdfWriter
            writer = PdfWriter()
            writer.add_blank_page(width=100, height=100)
            pdf_path = root / 'scan.pdf'
            with pdf_path.open('wb') as output:
                writer.write(output)
            with self.assertRaisesRegex(ValueError, 'OCR'):
                document_ingest.extract(pdf_path)

    def test_office_original_and_mail_attachments_are_persisted_and_previewable(self):
        mail = EmailMessage()
        mail['Subject'] = 'Customer update'
        mail.set_content('The rollout starts next month.')
        mail.add_attachment(b'Quarterly plan', maintype='text', subtype='plain', filename='plan.txt')
        import_id = 'email-preview'
        source_path = main.UPLOAD_DIR / f'{import_id}.eml'
        source_path.write_bytes(mail.as_bytes())
        with main.db() as conn:
            conn.execute("INSERT INTO imports(id,file_name,type,size,customer,project,status,progress,imported_at) VALUES (?, 'follow-up.eml', '邮件', '1 KB', '测试客户', '测试项目', 'processing', 0, '2026-10-20')", (import_id,))
        with patch('main.get_llm_config', return_value={'apiKey': ''}):
            main.process_document(import_id, source_path)
        transcript = self.request('/api/transcripts/tr-email-preview')[1]
        self.assertEqual(len(transcript['attachments']), 2)
        source, attachment = transcript['attachments']
        self.assertTrue((main.UPLOAD_DIR / source['storedName']).is_file())
        preview_status, preview = self.request(f"/api/files/{source['storedName']}/preview")
        self.assertEqual(preview_status, 200)
        self.assertIn('The rollout starts next month.', preview['text'])
        preview_status, preview = self.request(f"/api/files/{attachment['storedName']}/preview")
        self.assertEqual(preview_status, 200)
        self.assertEqual(preview['text'], 'Quarterly plan')
        self.assertEqual(transcript['summary']['confidence'], 0)
        archive, _ = main.create_backup_archive()
        main.restore_backup_archive(archive)
        self.assertEqual((main.UPLOAD_DIR / source['storedName']).read_bytes(), mail.as_bytes())
        self.assertEqual(self.request('/api/transcripts/tr-email-preview')[1]['attachments'][1]['storedName'], attachment['storedName'])

    def test_voice_transcription_uses_persistent_task_and_updates_chat(self):
        source_id = 'chat-voice-test'
        stored_name = f'{source_id}.mp3'
        (main.UPLOAD_DIR / stored_name).write_bytes(b'test audio')
        attachments = [{'id': 'voice-1', 'kind': 'voice', 'name': 'voice.mp3', 'storedName': stored_name}]
        with main.db() as conn:
            conn.execute("INSERT INTO chats(id,title,file_name,customer,project,imported_at,participants_json,messages_json,analysis_json,status,message_count,started_at,ended_at,attachments_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (source_id, 'Test', 'chat.txt', '测试客户', '测试项目', '2026-10-20', '[]', '[]', '{}', 'done', 0, '', '', json.dumps(attachments)))
        with patch('main.transcribe_audio_file', return_value='已确认下周进行评审'), patch('main.start_task', side_effect=lambda task_id, runner, *args: main._run_task(task_id, runner, *args)):
            status, response = self.request(f'/api/chats/{source_id}/attachments/transcribe', 'POST', {'attachmentId': 'voice-1'})
        self.assertEqual(status, 202)
        self.assertEqual(main.get_task(response['taskId'])['status'], 'succeeded')
        record = self.request(f'/api/chats/{source_id}')[1]
        self.assertEqual(record['attachments'][0]['transcript'], '已确认下周进行评审')
        self.assertEqual(record['attachments'][0]['transcriptStatus'], 'done')
        with main.db() as conn:
            self.assertEqual(sales.search(conn, '已确认下周进行评审')['counts']['chat'], 1)

        transcript_audio = 'transcript-voice-test.mp3'
        (main.UPLOAD_DIR / transcript_audio).write_bytes(b'test audio')
        with main.db() as conn:
            conn.execute("UPDATE transcripts SET attachments_json=? WHERE id='tr-001'", (json.dumps([{'id': 'voice-2', 'kind': 'voice', 'name': transcript_audio, 'storedName': transcript_audio}], ensure_ascii=False),))
        with patch('main.transcribe_audio_file', return_value='报价已确认'), patch('main.start_task', side_effect=lambda task_id, runner, *args: main._run_task(task_id, runner, *args)):
            status, response = self.request('/api/transcripts/tr-001/attachments/transcribe', 'POST', {'attachmentId': 'voice-2'})
        self.assertEqual(status, 202)
        self.assertEqual(self.request('/api/transcripts/tr-001')[1]['attachments'][0]['transcript'], '报价已确认')

    def test_segment_corrections_are_atomic_and_invalidate_summary_evidence(self):
        with main.db() as conn:
            conn.execute("UPDATE transcripts SET segments_json=?,summary_json=? WHERE id='tr-001'", (json.dumps([{'id': 's1', 'start': 0, 'end': 1, 'speaker': 'unknown', 'text': '原始内容'}], ensure_ascii=False), json.dumps({'needs': '原始内容', 'evidence': {'needs': '原始内容'}, 'confidence': 1, 'evidenceCount': 1}, ensure_ascii=False)))
        invalid = [{'id': 's1', 'speaker': 'customer', 'text': '已修改'}, {'id': 'missing', 'speaker': 'me', 'text': ''}]
        self.assertEqual(self.request('/api/transcripts/tr-001/segments', 'PATCH', {'segments': invalid})[0], 400)
        unchanged = self.request('/api/transcripts/tr-001')[1]
        self.assertEqual(unchanged['segments'][0]['text'], '原始内容')
        self.assertEqual(unchanged['corrections'], [])
        valid = [{'id': 's1', 'speaker': 'customer', 'text': '已修改'}]
        status, updated = self.request('/api/transcripts/tr-001/segments', 'PATCH', {'segments': valid})
        self.assertEqual(status, 200)
        self.assertEqual(updated['summary']['confidence'], 0)
        self.assertEqual(updated['summary'].get('evidence'), None)
        self.assertEqual(updated['corrections'][0]['after'], '已修改')

    def test_unverified_ai_evidence_does_not_create_requirements(self):
        response = {'choices': [{'message': {'content': json.dumps({'needs': '新增模块', 'evidence': {'needs': '模型编造的原文'}})}}]}
        with patch('main.maas_request', return_value=response):
            summary = main.summarize_transcript('实际通话没有需求')
        self.assertEqual(summary['confidence'], 0)
        self.assertEqual(summary['evidence'], {})
        main.insert_requirements_from_audio('imp-fake', '测试客户', '测试项目', summary)
        self.assertEqual(self.request(f'/api/customers/{quote("测试客户")}/requirements')[1], [])

    def test_regenerate_summary_uses_saved_text_and_persists_verified_result(self):
        with main.db() as conn:
            conn.execute("UPDATE transcripts SET segments_json=? WHERE id='tr-001'", (json.dumps([{'id': 's1', 'text': '客户明确需要报价'}], ensure_ascii=False),))
        generated = {'needs': '报价', 'evidence': {'needs': '客户明确需要报价'}, 'confidence': 1, 'evidenceCount': 1}
        with patch('main.get_llm_config', return_value={'apiKey': 'test-key'}), patch('main.summarize_transcript', return_value=generated) as summarize:
            status, record = self.request('/api/transcripts/tr-001/regenerate-summary', 'POST', {})
        self.assertEqual(status, 200)
        summarize.assert_called_once_with('客户明确需要报价')
        self.assertEqual(record['summary']['evidence']['needs'], '客户明确需要报价')

    def test_group_role_edit_keeps_the_selected_customer(self):
        source_id = 'chat-group-test'
        participants = [{'name': '销售', 'role': 'me'}, {'name': '客户甲', 'role': 'customer'}, {'name': '客户乙', 'role': 'customer'}]
        with main.db() as conn:
            conn.execute("INSERT INTO chats(id,title,file_name,customer,project,imported_at,participants_json,messages_json,analysis_json,status,message_count,started_at,ended_at,attachments_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (source_id, 'Group', 'chat.txt', '客户乙', '测试项目', '2026-10-20', json.dumps(participants), '[]', '{}', 'done', 0, '', '', '[]'))
        updated = main.update_chat_participants(source_id, participants)
        self.assertEqual(updated['customer'], '客户乙')
        self.assertEqual(len(updated['participants']), 3)

    def test_clarification_schema_and_draft_lifecycle_are_idempotent(self):
        conn = sqlite3.connect(':memory:')
        conn.row_factory = sqlite3.Row
        clarifications.migrate(conn)
        clarifications.migrate(conn)
        self.assertEqual(conn.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name LIKE 'clarification_%'").fetchone()[0], 5)
        conn.close()

        self.import_record('clarification-source', 'done', '测试客户')
        payload = {
            'name': '测试客户 · 需求澄清',
            'selectedScope': {'customerIds': ['测试客户'], 'projectIds': ['测试项目']},
            'modelSnapshot': {'model': 'mock-text'},
            'sources': [{
                'sourceType': 'transcript', 'sourceId': 'tr-001', 'customerId': '测试客户', 'projectId': '测试项目',
                'displayName': '测试通话', 'sourceKind': 'audio', 'textSnapshot': '客户需要报价', 'readable': True,
            }],
        }
        status, created = self.request('/api/clarifications', 'POST', payload)
        self.assertEqual(status, 201)
        self.assertEqual(created['status'], 'draft')
        self.assertEqual((created['sourceCount'], created['questionCount']), (1, 0))
        self.assertEqual(self.request('/api/clarifications?customer=%E6%B5%8B%E8%AF%95%E5%AE%A2%E6%88%B7')[0], 200)

        status, updated = self.request('/api/clarifications/' + created['id'], 'PATCH', {'status': 'active', 'totalBatches': 2, 'completedBatches': 1})
        self.assertEqual(status, 200)
        self.assertEqual((updated['status'], updated['totalBatches'], updated['completedBatches']), ('active', 2, 1))
        with main.db() as conn:
            conn.execute("INSERT INTO clarification_questions(id,record_id,customer_id,project_id,category,priority,text,status,created_at,updated_at) VALUES ('clq-test',?,?,?,?,?,'需要确认上线时间','pending','2026-10-20','2026-10-20')", (created['id'], '测试客户', '测试项目', '工期/预算/合同', 'must_confirm'))
            conn.execute("INSERT INTO clarification_evidence(id,question_id,source_snapshot_id,excerpt,source_label) VALUES ('cle-test','clq-test',?,'原文证据','测试通话')", (created['sources'][0]['id'],))
            conn.execute("INSERT INTO clarification_answers(id,question_id,answer_text,recorded_at) VALUES ('cla-test','clq-test','下个月上线','2026-10-21')")
        detail_status, detail = self.request('/api/clarifications/' + created['id'])
        self.assertEqual(detail_status, 200)
        self.assertEqual((detail['sources'][0]['sourceId'], detail['sources'][0]['textSnapshot']), ('tr-001', '客户需要报价'))
        self.assertEqual((detail['questionCount'], detail['questions'][0]['evidence'][0]['excerpt'], detail['questions'][0]['answers'][0]['answerText']), (1, '原文证据', '下个月上线'))

        delete_status, deleted = self.request('/api/clarifications/' + created['id'], 'DELETE')
        self.assertEqual(delete_status, 200)
        self.assertEqual(deleted['deleted'], created['id'])
        self.assertEqual(self.request('/api/clarifications/' + created['id'])[0], 404)
        self.assertEqual(self.request('/api/transcripts/tr-001')[0], 200)
        with main.db() as conn:
            self.assertIsNotNone(conn.execute("SELECT 1 FROM imports WHERE id='clarification-source'").fetchone())
            self.assertIsNone(conn.execute("SELECT 1 FROM clarification_records WHERE id=?", (created['id'],)).fetchone())
            for table, column, value in (
                ('clarification_sources', 'record_id', created['id']),
                ('clarification_questions', 'record_id', created['id']),
                ('clarification_evidence', 'question_id', 'clq-test'),
                ('clarification_answers', 'question_id', 'clq-test'),
            ):
                self.assertEqual(conn.execute(f"SELECT COUNT(*) FROM {table} WHERE {column}=?", (value,)).fetchone()[0], 0)

    def test_clarification_archive_filter_and_validation(self):
        status, created = self.request('/api/clarifications', 'POST', {'name': '可归档澄清单'})
        self.assertEqual(status, 201)
        record_id = created['id']
        self.assertEqual(self.request('/api/clarifications/' + record_id, 'PATCH', {'status': 'invalid'})[0], 400)
        self.assertEqual(self.request('/api/clarifications/' + record_id, 'PATCH', {'completedBatches': 1, 'totalBatches': 0})[0], 400)
        self.assertEqual(self.request('/api/clarifications/' + record_id, 'PATCH', {'status': 'archived'})[0], 200)
        self.assertEqual(self.request('/api/clarifications')[1], [])
        status, records = self.request('/api/clarifications?includeArchived=true')
        self.assertEqual(status, 200)
        self.assertEqual(records[0]['status'], 'archived')
        self.assertEqual(self.request('/api/clarifications/' + record_id, 'PATCH', {'status': 'active'})[0], 200)

    def test_clarification_sources_can_be_replaced_for_draft(self):
        status, created = self.request('/api/clarifications', 'POST', {'name': '选材草稿'})
        self.assertEqual(status, 201)
        payload = {
            'sources': [
                {
                    'sourceType': 'import', 'sourceId': 'imp-a', 'customerId': '客户甲', 'projectId': '项目甲',
                    'displayName': '客户甲-报价.txt', 'sourceKind': '聊天记录', 'readable': True,
                },
                {
                    'sourceType': 'import', 'sourceId': 'imp-b', 'customerId': '客户乙', 'projectId': '项目乙',
                    'displayName': '客户乙-扫描件.pdf', 'sourceKind': 'PDF', 'readable': False, 'extractionError': '仍在解析',
                },
            ],
        }
        replace_status, replaced = self.request('/api/clarifications/' + created['id'] + '/sources', 'POST', payload)
        self.assertEqual(replace_status, 200)
        self.assertEqual(replaced['sourceCount'], 2)
        self.assertEqual({item['customerId'] for item in replaced['sources']}, {'客户甲', '客户乙'})
        self.assertFalse(next(item for item in replaced['sources'] if item['sourceId'] == 'imp-b')['readable'])
        replace_status, replaced = self.request('/api/clarifications/' + created['id'] + '/sources', 'POST', {'sources': payload['sources'][:1]})
        self.assertEqual(replace_status, 200)
        self.assertEqual((replaced['sourceCount'], replaced['sources'][0]['sourceId']), (1, 'imp-a'))
        self.assertEqual(self.request('/api/clarifications/' + created['id'], 'PATCH', {'status': 'awaiting_confirmation'})[0], 200)
        blocked_status, _ = self.request('/api/clarifications/' + created['id'] + '/sources', 'POST', {'sources': []})
        self.assertEqual(blocked_status, 200)
        self.assertEqual(self.request('/api/clarifications/' + created['id'], 'PATCH', {'status': 'active'})[0], 200)
        locked_status, _ = self.request('/api/clarifications/' + created['id'] + '/sources', 'POST', {'sources': payload['sources']})
        self.assertEqual(locked_status, 400)

    def test_clarification_reads_frontend_import_ids_for_chat_and_transcript(self):
        self.import_record('imp-clarify-chat', 'done', '测试客户')
        self.import_record('imp-clarify-audio', 'done', '测试客户')
        with main.db() as conn:
            conn.execute("UPDATE imports SET transcript_id='chat-clarify' WHERE id='imp-clarify-chat'")
            conn.execute("UPDATE imports SET transcript_id='tr-001' WHERE id='imp-clarify-audio'")
            conn.execute("UPDATE transcripts SET segments_json=? WHERE id='tr-001'", (json.dumps([{'start': 0, 'text': '通话原文必须读取'}]),))
            conn.execute("INSERT INTO chats(id,title,file_name,customer,project,imported_at,participants_json,messages_json,analysis_json,status,message_count,started_at,ended_at,attachments_json) VALUES ('chat-clarify','测试聊天','chat.txt','测试客户','测试项目','2026-11-03','[]',?,'{}','done',1,'','','[]')", (json.dumps([{'sender': '甲方', 'content': '聊天原文必须读取'}]),))
        _, created = self.request('/api/clarifications', 'POST', {'sources': [
            {'sourceType': 'chat', 'sourceId': 'imp-clarify-chat', 'displayName': '聊天', 'readable': True},
            {'sourceType': 'transcript', 'sourceId': 'imp-clarify-audio', 'displayName': '通话', 'readable': True},
        ]})
        batches = main._clarification_batches(created['id'])
        self.assertEqual(len(batches), 2)
        self.assertIn('聊天原文必须读取', next(batch['text'] for batch in batches if batch['sourceId'] == 'imp-clarify-chat'))
        self.assertIn('通话原文必须读取', next(batch['text'] for batch in batches if batch['sourceId'] == 'imp-clarify-audio'))

    def test_clarification_model_cannot_change_known_customer_or_project(self):
        batch = {'sourceSnapshotId': 'snap-a', 'sourceId': 'imp-a', 'sourceLabel': '资料甲', 'sourceTime': '', 'customerId': '客户甲', 'projectId': '项目甲', 'text': '预算十万元'}
        result = {'choices': [{'message': {'content': json.dumps({'questions': [{'text': '请确认预算', 'customerId': '客户乙', 'projectId': '项目乙', 'evidence': [{'excerpt': '预算十万元'}]}]})}}]}
        parsed = main._parse_clarification_result(result, batch)
        self.assertEqual((parsed[0]['customerId'], parsed[0]['projectId']), ('客户甲', '项目甲'))

    def test_clarification_history_filter_uses_assigned_questions(self):
        _, created = self.request('/api/clarifications', 'POST', {'sources': [{'displayName': '未归属快照'}]})
        with main.db() as conn:
            question = clarifications.create_question(conn, created['id'], {'text': '请确认范围'})
            clarifications.update_question(conn, question['id'], {'customerId': '分配客户', 'projectId': '分配项目'})
        _, records = self.request('/api/clarifications?customer=' + quote('分配客户') + '&project=' + quote('分配项目'))
        self.assertEqual([record['id'] for record in records], [created['id']])
        self.assertIn('分配客户', records[0]['customers'])
        self.assertIn('分配项目', records[0]['projects'])

    def test_clarification_word_unassigned_filter_does_not_export_other_scopes(self):
        _, created = self.request('/api/clarifications', 'POST', {})
        with main.db() as conn:
            for fields in [
                {'text': '只导出未归属问题'},
                {'text': '客户项目待定问题', 'customerId': '测试客户'},
                {'text': '其他项目保密问题', 'customerId': '测试客户', 'projectId': '测试项目'},
            ]:
                clarifications.create_question(conn, created['id'], fields)
        for filters, included, excluded in [
            ('customer=' + quote('未归属客户'), '只导出未归属问题', ['客户项目待定问题', '其他项目保密问题']),
            ('customer=' + quote('测试客户') + '&project=' + quote('未归属项目'), '客户项目待定问题', ['只导出未归属问题', '其他项目保密问题']),
        ]:
            status, _, body = self.raw_request('/api/clarifications/' + created['id'] + '/export?format=docx&' + filters)
            self.assertEqual(status, 200)
            text = '\n'.join(paragraph.text for paragraph in Document(io.BytesIO(body)).paragraphs)
            self.assertIn(included, text)
            for other in excluded:
                self.assertNotIn(other, text)

    def test_clarification_analysis_saves_questions_and_evidence(self):
        payload = {
            'name': '分析测试单',
            'modelSnapshot': {'summaryModel': 'mock-text'},
            'sources': [{
                'sourceType': 'transcript', 'sourceId': 'tr-001', 'customerId': '测试客户', 'projectId': '测试项目',
                'displayName': '测试通话', 'sourceKind': '通话转写', 'textSnapshot': '客户希望一期在六月上线，预算需要确认。', 'readable': True,
            }],
        }
        status, created = self.request('/api/clarifications', 'POST', payload)
        self.assertEqual(status, 201)
        response = {
            'choices': [{
                'message': {'content': json.dumps({'questions': [{
                    'customerId': '测试客户', 'projectId': '测试项目', 'category': '工期/预算/合同',
                    'priority': 'must_confirm', 'text': '请确认一期期望的上线时间。',
                    'rationale': '工期会影响报价和排期。', 'conclusionType': 'gap', 'confidence': 0.9,
                    'evidence': [{'excerpt': '客户希望一期在六月上线', 'sourceId': 'tr-001', 'sourceLabel': '测试通话'}],
                }]}),},
            }],
        }
        config = {'apiKey': 'test-key', 'baseUrl': 'http://mock', 'summaryModel': 'mock-text', 'asrModel': '', 'visionModel': ''}
        with patch('main.get_llm_config', return_value=config), patch('main.maas_request', return_value=response) as model_request, patch('main.start_task', side_effect=lambda task_id, runner, *args: main._run_task(task_id, runner, *args)):
            analyze_status, analyze_result = self.request('/api/clarifications/' + created['id'] + '/analyze', 'POST', {})
        self.assertEqual(analyze_status, 202)
        self.assertEqual(analyze_result['status'], 'started')
        detail_status, detail = self.request('/api/clarifications/' + created['id'])
        self.assertEqual(detail_status, 200)
        self.assertEqual((detail['status'], detail['completedBatches'], detail['questionCount']), ('active', 1, 1))
        self.assertEqual(detail['questions'][0]['evidence'][0]['excerpt'], '客户希望一期在六月上线')
        self.assertGreaterEqual(detail['questions'][0]['confidence'], 0.8)
        self.assertEqual(detail['language'], 'zh-CN')
        self.assertIn('生成语言：zh-CN', model_request.call_args.args[1]['messages'][0]['content'])

    def test_clarification_language_persists_across_analysis_incremental_and_followup(self):
        source = {
            'sourceType': 'transcript', 'sourceId': 'tr-001', 'customerId': '测试客户', 'projectId': '测试项目',
            'displayName': '语言测试资料', 'sourceKind': '通话转写', 'textSnapshot': '客户希望六月上线，但预算未定。', 'readable': True,
        }
        status, created = self.request('/api/clarifications', 'POST', {
            'name': '语言测试单', 'language': 'en', 'modelSnapshot': {'summaryModel': 'mock-text'}, 'sources': [source],
        })
        self.assertEqual(status, 201)
        self.assertEqual(created['language'], 'en')
        path = '/api/clarifications/' + created['id']
        self.assertEqual(self.request(path, 'PATCH', {'language': '日本語'})[0], 200)
        self.assertEqual(self.request(path)[1]['language'], '日本語')
        config = {'apiKey': 'test-key', 'baseUrl': 'http://mock', 'summaryModel': 'mock-text', 'asrModel': '', 'visionModel': ''}
        responses = [{'choices': [{'message': {'content': json.dumps({'questions': [{
            'category': '工期/预算/合同', 'priority': 'must_confirm', 'text': text,
            'rationale': '日程を確認する必要があります。', 'evidence': [{'excerpt': '客户希望六月上线'}],
        }]}, ensure_ascii=False)}}]} for text in ('公開日はいつですか？', '予算はいくらですか？', '受入基準は何ですか？')]
        with patch('main.get_llm_config', return_value=config), patch('main.maas_request', side_effect=responses) as model_request, patch('main.start_task', side_effect=lambda task_id, runner, *args: main._run_task(task_id, runner, *args)):
            self.assertEqual(self.request(path + '/analyze', 'POST', {})[0], 202)
            detail = self.request(path)[1]
            self.assertEqual((detail['status'], detail['questionCount']), ('active', 1))
            question_id = detail['questions'][0]['id']
            self.assertEqual(self.request(path + '/sources/append', 'POST', {'sources': [{
                **source, 'sourceId': 'new-language-source', 'displayName': '新增语言资料', 'textSnapshot': '客户希望六月上线，需求有变化。',
            }]})[0], 200)
            self.assertEqual(self.request(path + '/analyze', 'POST', {'incremental': True})[0], 202)
            self.assertEqual(self.request('/api/clarification-questions/' + question_id + '/answers', 'POST', {
                'answerText': '客户希望六月上线，但验收标准仍未明确。',
            })[0], 201)
            followup_status, result = self.request('/api/clarification-questions/' + question_id + '/follow-up', 'POST', {})
        self.assertEqual((followup_status, result['added']), (201, 1))
        self.assertEqual(model_request.call_count, 3)
        for call in model_request.call_args_list:
            prompt = call.args[1]['messages'][0]['content']
            self.assertIn('生成语言：日本語', prompt)
            self.assertIn('证据原文不翻译', prompt)
        detail = self.request(path)[1]
        self.assertEqual((detail['language'], detail['questionCount']), ('日本語', 3))
        for question in detail['questions']:
            self.assertEqual(question['category'], '工期/预算/合同')
            self.assertEqual(question['evidence'][0]['excerpt'], '客户希望六月上线')

    def test_clarification_metrics_track_question_actions_and_first_ten(self):
        status, created = self.request('/api/clarifications', 'POST', {
            'name': '指标基线测试',
            'modelSnapshot': {'summaryModel': 'mock-text'},
            'sources': [{
                'sourceType': 'transcript', 'sourceId': 'tr-001', 'customerId': '测试客户', 'projectId': '测试项目',
                'displayName': '指标资料', 'sourceKind': '通话转写', 'textSnapshot': '一期范围和成功指标需要确认。', 'readable': True,
            }],
        })
        self.assertEqual(status, 201)
        response = {'choices': [{'message': {'content': json.dumps({'questions': [
            {'customerId': '测试客户', 'projectId': '测试项目', 'category': '一期范围', 'priority': 'must_confirm', 'text': '请确认一期包含哪些功能？', 'evidence': [{'excerpt': '一期范围需要确认', 'sourceId': 'tr-001'}]},
            {'customerId': '测试客户', 'projectId': '测试项目', 'category': '业务目标/指标', 'priority': 'important', 'text': '请确认一期的成功指标是什么？', 'evidence': [{'excerpt': '成功指标需要确认', 'sourceId': 'tr-001'}]},
        ]}, ensure_ascii=False)}}]}
        config = {'apiKey': 'test-key', 'baseUrl': 'http://mock', 'summaryModel': 'mock-text', 'asrModel': '', 'visionModel': ''}
        with patch('main.get_llm_config', return_value=config), patch('main.maas_request', return_value=response), patch('main.start_task', side_effect=lambda task_id, runner, *args: main._run_task(task_id, runner, *args)):
            self.assertEqual(self.request('/api/clarifications/' + created['id'] + '/analyze', 'POST', {})[0], 202)

        _, detail = self.request('/api/clarifications/' + created['id'])
        self.assertTrue(detail['analysisCompletedAt'])
        first_id, second_id = [question['id'] for question in detail['questions']]
        copy_path = '/api/clarifications/' + created['id'] + '/copy'
        self.assertEqual(self.request(copy_path, 'POST', {'questionIds': [first_id, second_id]})[1]['copied'], 2)
        self.assertEqual(self.request(copy_path, 'POST', {'questionIds': [first_id]})[1]['copied'], 0)
        self.assertEqual(self.request('/api/clarification-questions/' + first_id, 'PATCH', {'status': 'asked'})[0], 200)
        self.assertEqual(self.request('/api/clarification-questions/' + second_id, 'PATCH', {'status': 'deleted'})[0], 200)

        metrics_status, metrics = self.request('/api/clarifications/metrics')
        self.assertEqual(metrics_status, 200)
        self.assertEqual((metrics['completedAnalysisCount'], metrics['baselineCount'], metrics['ready']), (1, 1, False))
        self.assertEqual((metrics['generatedCount'], metrics['retainedCount'], metrics['copiedCount'], metrics['askedCount'], metrics['engagedCount']), (2, 1, 2, 1, 2))
        self.assertEqual(metrics['engagementRate'], 1)
        self.assertEqual(metrics['analyses'][0]['id'], created['id'])

    def test_clarification_duplicate_questions_merge_evidence(self):
        _, created = self.request('/api/clarifications', 'POST', {'name': '重复问题合并'})
        question = {
            'customerId': '测试客户', 'projectId': '测试项目', 'category': '一期范围', 'priority': 'important',
            'text': '请确认一期是否包含退款流程？', 'rationale': '资料需要核对。',
        }
        with main.db() as conn:
            inserted = clarifications.append_questions(conn, created['id'], [
                {**question, 'evidence': [{'sourceSnapshotId': 'source-a', 'excerpt': '聊天中提到退款流程。'}]},
                {**question, 'evidence': [{'sourceSnapshotId': 'source-b', 'excerpt': '会议中再次提到退款流程。'}]},
            ])
            detail = clarifications.get_record(conn, created['id'])
        self.assertEqual((inserted, detail['questionCount']), (1, 1))
        self.assertEqual({item['excerpt'] for item in detail['questions'][0]['evidence']}, {'聊天中提到退款流程。', '会议中再次提到退款流程。'})

    def test_clarification_metrics_use_first_ten_completed_records(self):
        with main.db() as conn:
            for index in range(12):
                record_id = f'metric-record-{index:02d}'
                completed_at = f'2026-10-{index + 1:02d}T10:00:00'
                conn.execute(
                    """INSERT INTO clarification_records (id,name,status,total_batches,completed_batches,created_at,updated_at,analysis_completed_at)
                    VALUES (?,?,'active',1,1,?,?,?)""",
                    (record_id, f'分析 {index:02d}', completed_at, completed_at, completed_at),
                )
                conn.execute(
                    """INSERT INTO clarification_questions (id,record_id,text,status,generated_from,created_at,updated_at)
                    VALUES (?,?,'测试问题','pending','initial',?,?)""",
                    (f'metric-question-{index:02d}', record_id, completed_at, completed_at),
                )
            metrics = clarifications.baseline_metrics(conn)
        self.assertEqual((metrics['completedAnalysisCount'], metrics['baselineCount'], metrics['ready']), (12, 10, True))
        self.assertEqual([item['id'] for item in metrics['analyses']], [f'metric-record-{index:02d}' for index in range(10)])
        self.assertEqual((metrics['generatedCount'], metrics['retainedCount'], metrics['engagementRate']), (10, 10, 1))

    def test_clarification_queued_analysis_can_resume_after_restart(self):
        status, created = self.request('/api/clarifications', 'POST', {
            'name': '重启恢复测试',
            'modelSnapshot': {'summaryModel': 'mock-text'},
            'sources': [{
                'sourceType': 'transcript', 'sourceId': 'tr-001', 'customerId': '测试客户', 'projectId': '测试项目',
                'displayName': '恢复资料', 'sourceKind': '通话转写', 'textSnapshot': '重启后继续分析。', 'readable': True,
            }],
        })
        self.assertEqual(status, 201)
        task_id = main.create_task('clarification_analysis', entity_id=created['id'], payload={'recordId': created['id'], 'incremental': False})
        with main.db() as conn:
            task_row = main.row_to_task(conn.execute('SELECT * FROM tasks WHERE id=?', (task_id,)).fetchone(), include_payload=True)
        response = {'choices': [{'message': {'content': json.dumps({'questions': [{'text': '重启后生成的问题？', 'evidence': [{'excerpt': '重启后继续分析', 'sourceId': 'tr-001'}]}]})}}]}
        config = {'apiKey': 'test-key', 'baseUrl': 'http://mock', 'summaryModel': 'mock-text', 'asrModel': '', 'visionModel': ''}
        with patch('main.get_llm_config', return_value=config), patch('main.maas_request', return_value=response), patch('main.start_task', side_effect=lambda task_id, runner, *args: main._run_task(task_id, runner, *args)):
            self.assertTrue(main.launch_task(task_row))
        task = main.get_task(task_id)
        _, detail = self.request('/api/clarifications/' + created['id'])
        self.assertEqual((task['status'], detail['status'], detail['questionCount']), ('succeeded', 'active', 1))

    def test_clarification_incremental_cancel_resumes_remaining_batch(self):
        status, created = self.request('/api/clarifications', 'POST', {
            'name': '增量取消恢复',
            'modelSnapshot': {'summaryModel': 'mock-text'},
            'sources': [{
                'sourceType': 'transcript', 'sourceId': 'tr-001', 'customerId': '测试客户', 'projectId': '测试项目',
                'displayName': '初始资料', 'sourceKind': '通话转写', 'textSnapshot': '初始结论。', 'readable': True,
            }],
        })
        self.assertEqual(status, 201)
        config = {'apiKey': 'test-key', 'baseUrl': 'http://mock', 'summaryModel': 'mock-text', 'asrModel': '', 'visionModel': ''}
        initial_response = {'choices': [{'message': {'content': json.dumps({'questions': [{'text': '原始问题？'}]})}}]}
        with patch('main.get_llm_config', return_value=config), patch('main.maas_request', return_value=initial_response), patch('main.start_task', side_effect=lambda task_id, runner, *args: main._run_task(task_id, runner, *args)):
            self.assertEqual(self.request('/api/clarifications/' + created['id'] + '/analyze', 'POST', {})[0], 202)
        appended = self.request('/api/clarifications/' + created['id'] + '/sources/append', 'POST', {'sources': [
            {'sourceType': 'chat', 'sourceId': 'chat-inc-a', 'customerId': '测试客户', 'projectId': '测试项目', 'displayName': '新增资料 A', 'sourceKind': '聊天记录', 'textSnapshot': '新增资料 A 的内容。', 'readable': True},
            {'sourceType': 'chat', 'sourceId': 'chat-inc-b', 'customerId': '测试客户', 'projectId': '测试项目', 'displayName': '新增资料 B', 'sourceKind': '聊天记录', 'textSnapshot': '新增资料 B 的内容。', 'readable': True},
        ]})
        self.assertEqual(appended[0], 200)

        batches = [
            {'sourceSnapshotId': 'source-a', 'sourceId': 'chat-inc-a', 'sourceLabel': '新增资料 A', 'sourceTime': '', 'customerId': '测试客户', 'projectId': '测试项目', 'text': '新增资料 A 的内容。'},
            {'sourceSnapshotId': 'source-b', 'sourceId': 'chat-inc-b', 'sourceLabel': '新增资料 B', 'sourceTime': '', 'customerId': '测试客户', 'projectId': '测试项目', 'text': '新增资料 B 的内容。'},
        ]
        first_response = {'choices': [{'message': {'content': json.dumps({'questions': [{'text': '新增问题 A？', 'evidence': [{'excerpt': '新增资料 A 的内容。'}]}]})}}]}
        second_response = {'choices': [{'message': {'content': json.dumps({'questions': [{'text': '新增问题 B？', 'evidence': [{'excerpt': '新增资料 B 的内容。'}]}]})}}]}
        original_progress = main.set_task_progress
        cancelled = False

        def cancel_after_first_batch(task_id, progress):
            nonlocal cancelled
            original_progress(task_id, progress)
            if progress == 50 and not cancelled:
                cancelled = True
                main.cancel_task(task_id)

        with patch('main._clarification_batches', return_value=batches), patch('main.get_llm_config', return_value=config), patch('main.maas_request', side_effect=[first_response, second_response]), patch('main.set_task_progress', side_effect=cancel_after_first_batch), patch('main.start_task', side_effect=lambda task_id, runner, *args: main._run_task(task_id, runner, *args)):
            self.assertEqual(self.request('/api/clarifications/' + created['id'] + '/analyze', 'POST', {'incremental': True})[0], 202)
        _, partial = self.request('/api/clarifications/' + created['id'])
        self.assertEqual((partial['status'], partial['completedBatches'], partial['questionCount']), ('partial', 1, 2))

        with patch('main._clarification_batches', return_value=batches) as batch_loader, patch('main.get_llm_config', return_value=config), patch('main.maas_request', return_value=second_response) as model_request, patch('main.start_task', side_effect=lambda task_id, runner, *args: main._run_task(task_id, runner, *args)):
            self.assertEqual(self.request('/api/clarifications/' + created['id'] + '/analyze', 'POST', {})[0], 202)
            batch_loader.assert_called_once_with(created['id'], pending_only=True)
        _, resumed = self.request('/api/clarifications/' + created['id'])
        self.assertEqual((resumed['status'], resumed['completedBatches'], resumed['questionCount']), ('active', 2, 3))
        self.assertEqual(model_request.call_count, 1)

    def test_clarification_analysis_requires_readable_source(self):
        status, created = self.request('/api/clarifications', 'POST', {'name': '不可读测试', 'sources': [{
            'sourceType': 'import', 'sourceId': 'imp-unreadable', 'displayName': '扫描件.pdf', 'sourceKind': 'PDF', 'readable': False, 'extractionError': 'OCR 失败',
        }]})
        self.assertEqual(status, 201)
        analyze_status, result = self.request('/api/clarifications/' + created['id'] + '/analyze', 'POST', {})
        self.assertEqual(analyze_status, 400)
        self.assertEqual(result['error'], 'no_readable_sources')

    def test_clarification_analysis_failure_keeps_completed_batches_for_retry(self):
        source_text = '客户已经确认一期范围。' + ('补充资料。' * 3000)
        status, created = self.request('/api/clarifications', 'POST', {'name': '可重试分析', 'language': 'en', 'modelSnapshot': {'summaryModel': 'mock-text'}, 'sources': [{
            'sourceType': 'transcript', 'sourceId': 'tr-001', 'customerId': '测试客户', 'projectId': '测试项目',
            'displayName': '长资料', 'sourceKind': '通话转写', 'textSnapshot': source_text, 'readable': True,
        }]})
        self.assertEqual(status, 201)
        response = {'choices': [{'message': {'content': json.dumps({'questions': [{
            'customerId': '测试客户', 'projectId': '测试项目', 'category': '一期范围', 'priority': 'important',
            'text': '请确认一期范围是否保持不变。', 'rationale': '需要锁定报价边界。', 'confidence': 0.8,
            'evidence': [{'excerpt': '客户已经确认一期范围', 'sourceId': 'tr-001'}],
        }]})}}]}
        config = {'apiKey': 'test-key', 'baseUrl': 'http://mock', 'summaryModel': 'mock-text', 'asrModel': '', 'visionModel': ''}
        with patch('main.get_llm_config', return_value=config), patch('main.maas_request', side_effect=[response, RuntimeError('模型超时')]), patch('main.start_task', side_effect=lambda task_id, runner, *args: main._run_task(task_id, runner, *args)):
            self.assertEqual(self.request('/api/clarifications/' + created['id'] + '/analyze', 'POST', {})[0], 202)
        _, partial = self.request('/api/clarifications/' + created['id'])
        self.assertEqual((partial['status'], partial['completedBatches'], partial['totalBatches'], partial['questionCount']), ('partial', 1, 2, 1))
        self.assertIn('超时', partial['errorMessage'])
        with patch('main.get_llm_config', return_value=config), patch('main.maas_request', return_value=response) as model_request, patch('main.start_task', side_effect=lambda task_id, runner, *args: main._run_task(task_id, runner, *args)):
            self.assertEqual(self.request('/api/clarifications/' + created['id'] + '/analyze', 'POST', {})[0], 202)
        _, retried = self.request('/api/clarifications/' + created['id'])
        self.assertEqual(retried['language'], 'en')
        self.assertIn('生成语言：en', model_request.call_args.args[1]['messages'][0]['content'])
        self.assertEqual((retried['status'], retried['completedBatches'], retried['totalBatches']), ('active', 2, 2))

    def test_clarification_incremental_sources_keep_history_and_mark_conflicts(self):
        status, created = self.request('/api/clarifications', 'POST', {
            'name': '增量分析测试单',
            'modelSnapshot': {'summaryModel': 'mock-text'},
            'sources': [{
                'sourceType': 'transcript', 'sourceId': 'tr-001', 'customerId': '测试客户', 'projectId': '测试项目',
                'displayName': '首次沟通', 'sourceKind': '通话转写', 'textSnapshot': '一期范围已经确定。', 'readable': True,
            }],
        })
        self.assertEqual(status, 201)
        initial_response = {'choices': [{'message': {'content': json.dumps({'questions': [{
            'customerId': '测试客户', 'projectId': '测试项目', 'category': '一期范围', 'priority': 'important',
            'text': '请确认一期范围是否保持不变。', 'rationale': '需要锁定报价边界。', 'conclusionType': 'fact',
            'evidence': [{'excerpt': '一期范围已经确定', 'sourceId': 'tr-001'}],
        }]}, ensure_ascii=False)}}]}
        config = {'apiKey': 'test-key', 'baseUrl': 'http://mock', 'summaryModel': 'mock-text', 'asrModel': '', 'visionModel': ''}
        with patch('main.get_llm_config', return_value=config), patch('main.maas_request', return_value=initial_response), patch('main.start_task', side_effect=lambda task_id, runner, *args: main._run_task(task_id, runner, *args)):
            self.assertEqual(self.request('/api/clarifications/' + created['id'] + '/analyze', 'POST', {})[0], 202)
        _, first = self.request('/api/clarifications/' + created['id'])
        self.assertEqual(first['sources'][0]['analyzed'], True)
        self.assertEqual(first['questionCount'], 1)

        new_source = {
            'sourceType': 'chat', 'sourceId': 'chat-002', 'customerId': '测试客户', 'projectId': '测试项目',
            'displayName': '预算补充消息', 'sourceKind': '聊天记录',
            'textSnapshot': '旧消息说预算上限为80万。最新沟通说预算上限为100万。', 'readable': True,
        }
        append_status, appended = self.request('/api/clarifications/' + created['id'] + '/sources/append', 'POST', {'sources': [new_source, new_source]})
        self.assertEqual(append_status, 200)
        self.assertEqual(len(appended['sources']), 2)
        self.assertEqual(sum(1 for source in appended['sources'] if not source['analyzed']), 1)

        with patch('main.get_llm_config', return_value=config), patch('main.maas_request', side_effect=RuntimeError('增量模型超时')), patch('main.start_task', side_effect=lambda task_id, runner, *args: main._run_task(task_id, runner, *args)):
            failed_status, _ = self.request('/api/clarifications/' + created['id'] + '/analyze', 'POST', {'incremental': True})
        self.assertEqual(failed_status, 202)
        _, failed = self.request('/api/clarifications/' + created['id'])
        self.assertEqual((failed['status'], failed['questionCount']), ('failed', 1))
        self.assertFalse(next(source for source in failed['sources'] if source['sourceId'] == 'chat-002')['analyzed'])

        conflict_response = {'choices': [{'message': {'content': json.dumps({'questions': [{
            'customerId': '测试客户', 'projectId': '测试项目', 'category': '工期/预算/合同', 'priority': 'later',
            'text': '请确认最终预算上限是80万还是100万。', 'rationale': '资料中出现两个预算口径。', 'conclusionType': 'conflict', 'confidence': 0.92,
            'evidence': [
                {'excerpt': '旧消息说预算上限为80万', 'sourceId': 'chat-002'},
                {'excerpt': '最新沟通说预算上限为100万', 'sourceId': 'chat-002'},
            ],
        }]}, ensure_ascii=False)}}]}
        with patch('main.get_llm_config', return_value=config), patch('main.maas_request', return_value=conflict_response), patch('main.start_task', side_effect=lambda task_id, runner, *args: main._run_task(task_id, runner, *args)):
            incremental_status, incremental = self.request('/api/clarifications/' + created['id'] + '/analyze', 'POST', {'incremental': True})
        self.assertEqual(incremental_status, 202)
        self.assertEqual(incremental['status'], 'started')
        _, updated = self.request('/api/clarifications/' + created['id'])
        self.assertEqual((updated['status'], updated['questionCount']), ('active', 2))
        self.assertEqual(sum(1 for source in updated['sources'] if source['analyzed']), 2)
        conflict = next(question for question in updated['questions'] if question['conclusionType'] == 'conflict')
        self.assertEqual(conflict['priority'], 'must_confirm')
        self.assertEqual(len(conflict['evidence']), 2)

        unassigned_status, unassigned = self.request('/api/clarifications/' + created['id'] + '/questions', 'POST', {
            'category': '业务目标/指标', 'priority': 'important', 'text': '请确认业务成功指标。',
        })
        self.assertEqual(unassigned_status, 201)
        assignment_results = [self.request('/api/clarification-questions/' + question_id, 'PATCH', {
            'customerId': '新客户', 'projectId': '新项目',
        }) for question_id in (conflict['id'], unassigned['id'])]
        self.assertEqual([status for status, _ in assignment_results], [200, 200])
        self.assertTrue(all((question['customerId'], question['projectId']) == ('新客户', '新项目') for _, question in assignment_results))
        no_new_status, no_new = self.request('/api/clarifications/' + created['id'] + '/analyze', 'POST', {'incremental': True})
        self.assertEqual((no_new_status, no_new['error']), (400, 'no_new_sources'))

    def test_clarification_cross_source_conflict_keeps_both_evidence_and_scopes_context(self):
        old = {'sourceId': 'old-a', 'customerId': '客户甲', 'projectId': '项目甲', 'displayName': '旧资料', 'textSnapshot': '旧预算为八万元', 'readable': True}
        foreign = {'sourceId': 'old-b', 'customerId': '客户乙', 'projectId': '项目乙', 'displayName': '其他客户资料', 'textSnapshot': '客户乙的保密预算', 'readable': True}
        _, created = self.request('/api/clarifications', 'POST', {'sources': [old, foreign]})
        old_snapshot = next(source['id'] for source in created['sources'] if source['sourceId'] == 'old-a')
        with main.db() as conn:
            conn.execute("UPDATE clarification_records SET status='active' WHERE id=?", (created['id'],))
            conn.execute("UPDATE clarification_sources SET analyzed=1 WHERE record_id=?", (created['id'],))
            clarifications.append_questions(conn, created['id'], [
                {'customerId': '客户甲', 'projectId': '项目甲', 'text': '请确认旧预算', 'evidence': [{'sourceSnapshotId': old_snapshot, 'excerpt': old['textSnapshot']}]},
                {'customerId': '客户乙', 'projectId': '项目乙', 'text': '客户乙的保密问题'},
            ])
            clarifications.append_sources(conn, created['id'], [{
                'sourceId': 'new-a', 'customerId': '客户甲', 'projectId': '项目甲', 'displayName': '新资料', 'textSnapshot': '最新预算为十万元', 'readable': True,
            }])
        response = {'choices': [{'message': {'content': json.dumps({'questions': [{
            'text': '请确认最终预算为八万还是十万', 'customerId': '客户乙', 'projectId': '项目乙', 'conclusionType': 'conflict', 'priority': 'later',
            'evidence': [{'sourceId': 'old-a', 'excerpt': old['textSnapshot']}, {'sourceId': 'new-a', 'excerpt': '最新预算为十万元'}, {'sourceId': 'old-b', 'excerpt': foreign['textSnapshot']}],
        }]})}}]}
        config = {'apiKey': 'test-key', 'baseUrl': 'http://mock', 'summaryModel': 'mock-text'}
        with patch('main.get_llm_config', return_value=config), patch('main.maas_request', return_value=response) as model:
            main.process_clarification_analysis(created['id'], True)
        prompt = model.call_args.args[1]['messages'][0]['content']
        self.assertIn(old['textSnapshot'], prompt)
        self.assertNotIn(foreign['textSnapshot'], prompt)
        self.assertNotIn('客户乙的保密问题', prompt)
        _, detail = self.request('/api/clarifications/' + created['id'])
        conflict = next(question for question in detail['questions'] if question['conclusionType'] == 'conflict')
        self.assertEqual((conflict['customerId'], conflict['projectId'], conflict['priority']), ('客户甲', '项目甲', 'must_confirm'))
        self.assertEqual({evidence['excerpt'] for evidence in conflict['evidence']}, {old['textSnapshot'], '最新预算为十万元'})
        self.assertEqual(model.call_count, 1)

    def test_clarification_assignment_preserves_answers_evidence_and_original_sources(self):
        self.import_record('assignment-source', 'done', '测试客户')
        status, created = self.request('/api/clarifications', 'POST', {'name': '按资料分配', 'sources': [
            {'sourceId': 'tr-001', 'displayName': '资料甲', 'textSnapshot': '一期包括登录', 'readable': True},
            {'sourceId': 'assignment-source', 'displayName': '资料乙', 'textSnapshot': '需要核对范围', 'readable': True},
        ]})
        self.assertEqual(status, 201)
        source_a, source_b = [source['id'] for source in created['sources']]
        with main.db() as conn:
            original_import = dict(conn.execute("SELECT * FROM imports WHERE id='assignment-source'").fetchone())
            original_transcript = dict(conn.execute("SELECT * FROM transcripts WHERE id='tr-001'").fetchone())
            conn.execute("UPDATE clarification_records SET status='active' WHERE id=?", (created['id'],))
            clarifications.append_questions(conn, created['id'], [
                {'text': '请确认登录范围', 'evidence': [{'sourceSnapshotId': source_a, 'excerpt': '一期包括登录'}]},
                {'text': '请确认两份资料的范围', 'evidence': [
                    {'sourceSnapshotId': source_a, 'excerpt': '一期包括登录'},
                    {'sourceSnapshotId': source_b, 'excerpt': '需要核对范围'},
                ]},
                {'text': '请确认资料乙的内容', 'evidence': [{'sourceSnapshotId': source_b, 'excerpt': '需要核对范围'}]},
            ])
            detail = clarifications.get_record(conn, created['id'])
            parent = next(question for question in detail['questions'] if question['text'] == '请确认登录范围')
            clarifications.record_question_answer(conn, parent['id'], '登录需要手机号验证码')
            clarifications.append_questions(conn, created['id'], [{
                'text': '请确认验证码有效期', 'parentQuestionId': parent['id'],
                'evidence': [{'sourceSnapshotId': 'answer:' + parent['id'], 'excerpt': '登录需要手机号验证码'}],
            }], generated_from='followup')
        _, before = self.request('/api/clarifications/' + created['id'])
        targets = {question['id'] for question in before['questions'] if question['text'] in {'请确认登录范围', '请确认验证码有效期'}}
        shared = next(question for question in before['questions'] if question['text'] == '请确认两份资料的范围')
        with patch('main.maas_request') as model:
            for question_id in targets:
                self.assertEqual(self.request('/api/clarification-questions/' + question_id, 'PATCH', {
                    'customerId': '测试客户', 'projectId': '测试项目',
                })[0], 200)
            self.assertEqual(self.request('/api/clarification-questions/' + shared['id'], 'PATCH', {
                'customerId': '客户乙', 'projectId': '另一个项目',
            })[0], 200)
            model.assert_not_called()
        _, after = self.request('/api/clarifications/' + created['id'])
        self.assertEqual(after['sources'], before['sources'])
        self.assertEqual(after['questionCount'], before['questionCount'])
        for old in before['questions']:
            new = next(question for question in after['questions'] if question['id'] == old['id'])
            if old['id'] in targets:
                self.assertEqual((new['customerId'], new['projectId']), ('测试客户', '测试项目'))
            elif old['id'] == shared['id']:
                self.assertEqual((new['customerId'], new['projectId']), ('客户乙', '另一个项目'))
                self.assertEqual(len(new['evidence']), 2)
            else:
                self.assertEqual(new, old)
            ignored = {'customerId', 'projectId', 'updatedAt'}
            self.assertEqual({key: value for key, value in new.items() if key not in ignored},
                             {key: value for key, value in old.items() if key not in ignored})
        with main.db() as conn:
            self.assertEqual(dict(conn.execute("SELECT * FROM imports WHERE id='assignment-source'").fetchone()), original_import)
            self.assertEqual(dict(conn.execute("SELECT * FROM transcripts WHERE id='tr-001'").fetchone()), original_transcript)

    def test_clarification_question_workbench_updates_and_adds_questions(self):
        status, created = self.request('/api/clarifications', 'POST', {'name': '问题工作台'})
        self.assertEqual(status, 201)
        with main.db() as conn:
            question = clarifications.create_question(conn, created['id'], {
                'customerId': '测试客户', 'projectId': '测试项目', 'category': '一期范围',
                'priority': 'important', 'text': '请确认一期范围。', 'rationale': '需要锁定报价边界。',
            })
        self.assertIsNotNone(question)
        question_id = question['id']
        update_status, updated = self.request('/api/clarification-questions/' + question_id, 'PATCH', {
            'text': '请确认一期的功能范围。', 'priority': 'must_confirm', 'status': 'not_applicable',
        })
        self.assertEqual(update_status, 200)
        self.assertEqual((updated['text'], updated['priority'], updated['status']), ('请确认一期的功能范围。', 'must_confirm', 'not_applicable'))
        add_status, added = self.request('/api/clarifications/' + created['id'] + '/questions', 'POST', {
            'customerId': '测试客户', 'projectId': '测试项目', 'category': '工期/预算/合同', 'priority': 'must_confirm', 'text': '请确认目标上线日期。',
        })
        self.assertEqual(add_status, 201)
        self.assertEqual(added['generatedFrom'], 'custom')
        delete_status, deleted = self.request('/api/clarification-questions/' + question_id, 'PATCH', {'status': 'deleted'})
        self.assertEqual(delete_status, 200)
        self.assertEqual(deleted['status'], 'deleted')
        _, detail = self.request('/api/clarifications/' + created['id'])
        self.assertEqual(detail['questionCount'], 1)
        self.assertEqual(detail['questions'][0]['text'], '请确认目标上线日期。')

    def test_clarification_answers_followups_and_writeback_preview(self):
        status, created = self.request('/api/clarifications', 'POST', {'name': '回答闭环'})
        self.assertEqual(status, 201)
        with main.db() as conn:
            conn.execute("UPDATE clarification_records SET status='active' WHERE id=?", (created['id'],))
            question = clarifications.create_question(conn, created['id'], {
                'customerId': '测试客户', 'projectId': '测试项目', 'category': '一期范围',
                'priority': 'must_confirm', 'text': '一期需要包含哪些功能？',
            })
        question_id = question['id']
        self.assertEqual(self.request('/api/clarification-questions/' + question_id, 'PATCH', {'status': 'asked'})[0], 200)
        answer_status, answered = self.request('/api/clarification-questions/' + question_id + '/answers', 'POST', {'answerText': '一期包含登录、商品和订单，计划六月上线。'})
        self.assertEqual(answer_status, 201)
        self.assertEqual(answered['status'], 'answered')
        self.assertEqual(answered['answers'][0]['answerText'], '一期包含登录、商品和订单，计划六月上线。')
        self.assertEqual(self.request('/api/clarifications/' + created['id'])[1]['status'], 'completed')

        followup_response = {'choices': [{'message': {'content': json.dumps({'questions': [{
            'customerId': '测试客户', 'projectId': '测试项目', 'category': '一期范围', 'priority': 'important',
            'text': '请确认一期是否还需要包含退款流程。', 'rationale': '回答列出了核心功能，但未说明退款流程。', 'confidence': 0.82,
            'evidence': [{'excerpt': '一期包含登录、商品和订单', 'sourceId': question_id}],
        }]}, ensure_ascii=False)}}]}
        config = {'apiKey': 'test-key', 'baseUrl': 'http://mock', 'summaryModel': 'mock-text', 'asrModel': '', 'visionModel': ''}
        with patch('main.get_llm_config', return_value=config), patch('main.maas_request', return_value=followup_response):
            followup_status, followup = self.request('/api/clarification-questions/' + question_id + '/follow-up', 'POST', {})
        self.assertEqual(followup_status, 201)
        self.assertEqual(followup['added'], 1)
        self.assertEqual(followup['record']['questionCount'], 2)
        self.assertEqual(followup['record']['status'], 'active')

        preview_status, preview = self.request('/api/clarification-questions/' + question_id + '/action-preview', 'POST', {
            'action': 'requirement', 'customer': '测试客户', 'project': '测试项目', 'title': '一期功能范围', 'priority': 'P0',
        })
        self.assertEqual(preview_status, 200)
        self.assertEqual((preview['changes']['status'], preview['changes']['sourceType']), ('待确认', 'clarification'))
        confirm_status, confirmed = self.request('/api/clarification-questions/' + question_id + '/action-confirm', 'POST', {
            'action': 'requirement', 'customer': '测试客户', 'project': '测试项目', 'title': '一期功能范围', 'priority': 'P0',
        })
        self.assertEqual(confirm_status, 200)
        self.assertEqual(confirmed['result']['status'], '待确认')
        self.assertEqual(confirmed['question']['answers'][0]['convertedAction']['action'], 'requirement')

        project_preview_status, project_preview = self.request('/api/clarification-questions/' + question_id + '/action-preview', 'POST', {
            'action': 'project', 'targetProjectId': self.project['id'], 'description': '一期目标上线：六月。',
        })
        self.assertEqual(project_preview_status, 200)
        self.assertEqual(project_preview['target']['projectId'], self.project['id'])
        project_confirm_status, project_confirm = self.request('/api/clarification-questions/' + question_id + '/action-confirm', 'POST', {
            'action': 'project', 'targetProjectId': self.project['id'], 'description': '一期目标上线：六月。',
        })
        self.assertEqual(project_confirm_status, 200)
        self.assertEqual(project_confirm['result']['description'], '一期目标上线：六月。')

    def test_clarification_latest_answer_uses_save_order_when_timestamps_match(self):
        _, created = self.request('/api/clarifications', 'POST', {})
        with main.db() as conn:
            question = clarifications.create_question(conn, created['id'], {'text': '请确认登录范围'})
            with patch('clarifications._now', return_value='2026-11-03T10:00:00'), patch('clarifications._id', side_effect=['cla-z', 'cla-a']):
                clarifications.record_question_answer(conn, question['id'], '第一版回答')
                updated = clarifications.record_question_answer(conn, question['id'], '第二版回答')
        self.assertEqual([answer['id'] for answer in updated['answers']], ['cla-z', 'cla-a'])
        preview = main.clarification_action_preview(question['id'], {'action': 'requirement', 'customer': '测试客户'})
        self.assertEqual((preview['answerId'], preview['changes']['description'], preview['changes']['priority']), ('cla-a', '第二版回答', 'P1'))
        config = {'apiKey': 'test-key', 'summaryModel': 'mock-text'}
        response = {'choices': [{'message': {'content': '{"questions":[]}'}}]}
        with patch('main.get_llm_config', return_value=config), patch('main.maas_request', return_value=response) as model:
            main.generate_clarification_followup(question['id'])
        self.assertTrue(model.call_args.args[1]['messages'][0]['content'].endswith('第二版回答'))
        status, confirmed = self.request('/api/clarification-questions/' + question['id'] + '/action-confirm', 'POST', {
            'action': 'requirement', 'customer': '测试客户',
        })
        self.assertEqual(status, 200)
        self.assertEqual(confirmed['result']['description'], '第二版回答')
        _, detail = self.request('/api/clarifications/' + created['id'])
        answers = detail['questions'][0]['answers']
        self.assertEqual([answer['id'] for answer in answers], ['cla-z', 'cla-a'])
        self.assertIsNone(answers[0]['convertedAction'])
        self.assertEqual(answers[1]['convertedAction']['resultId'], confirmed['result']['id'])

    def test_clarification_duplicate_lifecycle_and_public_word_export(self):
        status, created = self.request('/api/clarifications', 'POST', {'name': '可交付澄清单'})
        self.assertEqual(status, 201)
        with main.db() as conn:
            conn.execute("UPDATE clarification_records SET status='active' WHERE id=?", (created['id'],))
            question = clarifications.create_question(conn, created['id'], {
                'customerId': '测试客户', 'projectId': '测试项目', 'category': '业务目标/指标',
                'priority': 'must_confirm', 'text': '请确认一期成功指标。', 'rationale': '需要明确验收口径。',
            })
            clarifications.record_question_answer(conn, question['id'], '以注册转化率作为主要指标。')
        duplicate_status, duplicate = self.request('/api/clarifications/' + created['id'] + '/duplicate', 'POST', {})
        self.assertEqual(duplicate_status, 201)
        self.assertEqual((duplicate['status'], duplicate['questionCount'], duplicate['questions'][0]['customerId'], duplicate['questions'][0]['answerText']), ('draft', 1, '', ''))
        self.assertEqual(self.request('/api/clarifications/' + created['id'], 'PATCH', {'status': 'archived'})[0], 200)
        self.assertEqual([item['id'] for item in self.request('/api/clarifications')[1]], [duplicate['id']])
        all_records = self.request('/api/clarifications?includeArchived=true')[1]
        self.assertTrue(any(item['id'] == created['id'] and item['status'] == 'archived' for item in all_records))
        self.assertEqual(self.request('/api/clarifications/' + created['id'], 'PATCH', {'status': 'active'})[0], 200)
        export_status, headers, body = self.raw_request('/api/clarifications/' + created['id'] + '/export?format=docx')
        self.assertEqual(export_status, 200)
        self.assertIn('wordprocessingml.document', headers.get('Content-Type', ''))
        self.assertGreater(len(body), 1000)
        document = Document(io.BytesIO(body))
        self.assertIn('请确认一期成功指标。', '\n'.join(paragraph.text for paragraph in document.paragraphs))


if __name__ == '__main__':
    unittest.main()
