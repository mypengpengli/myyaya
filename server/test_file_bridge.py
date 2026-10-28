import hashlib
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import tempfile
import threading
import unittest
from urllib import request, error

import file_bridge as bridge

class FileBridgeTest(unittest.TestCase):
    def test_publish_download_and_boundaries(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); sources = root / 'output'; task = sources / 'task-fixture'; task.mkdir(parents=True)
            file = task / 'result.txt'; file.write_text('myyaya result', encoding='utf-8')
            store = root / 'store'
            receipt = bridge.publish('task-fixture', [str(file)], sources, store)
            self.assertEqual(receipt['files'][0]['sha256'], hashlib.sha256(file.read_bytes()).hexdigest())
            with self.assertRaises(ValueError): bridge.publish('task-fixture', [str(file)], sources, store)
            outside = root / 'private.txt'; outside.write_text('not an artifact')
            with self.assertRaises(ValueError): bridge.publish('other-task', [str(outside)], sources, store)
            with self.assertRaises(ValueError): bridge.publish('../escape', [], sources, store)
            self.assertFalse((store / 'other-task').exists())
            server = ThreadingHTTPServer(('127.0.0.1', 0), bridge.make_handler(store, 'fixture-only-token'))
            thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
            try:
                origin = f'http://127.0.0.1:{server.server_port}'
                with self.assertRaises(error.HTTPError) as denied: request.urlopen(origin + '/myyaya/v1/capabilities')
                self.assertEqual(denied.exception.code, 401)
                def get(path):
                    return request.urlopen(request.Request(origin + path, headers={'Authorization': 'Bearer fixture-only-token'}))
                with get('/myyaya/v1/tasks/task-fixture/files') as response:
                    manifest = json.load(response); self.assertEqual(manifest, receipt)
                path = '/myyaya/v1/tasks/task-fixture/files/' + receipt['files'][0]['id']
                for _ in range(2):
                    with get(path) as response: self.assertEqual(response.read(), file.read_bytes(), 'downloads must survive retry')
                with self.assertRaises(error.HTTPError): get('/myyaya/v1/tasks/task-fixture/files/../../private.txt')
                file.write_text('original changed')
                with get(path) as response: self.assertEqual(response.read(), b'myyaya result', 'published snapshot is immutable')
            finally:
                server.shutdown(); server.server_close(); thread.join()

    def test_size_and_type_fail_without_manifest(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); task = root / 'source' / 'fixture'; task.mkdir(parents=True)
            file = task / 'bad.html'; file.write_text('<script>no execution</script>')
            with self.assertRaises(ValueError): bridge.publish('fixture', [str(file)], root / 'source', root / 'store')
            file = task / 'empty.txt'; file.touch()
            with self.assertRaises(ValueError): bridge.publish('fixture', [str(file)], root / 'source', root / 'store')
            self.assertEqual(list((root / 'store').iterdir()), [])

    def test_office_originals_are_delivered_without_conversion(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary); task = root / 'source' / 'fixture'; task.mkdir(parents=True)
            sources = [task / '报告.docx', task / '演示.pptx']
            for index, source in enumerate(sources): source.write_bytes(b'PK-office-fixture-' + bytes([index]))
            receipt = bridge.publish('fixture', [str(file) for file in sources], root / 'source', root / 'store')
            self.assertEqual([file['name'] for file in receipt['files']], ['报告.docx', '演示.pptx'])
            for source, file in zip(sources, receipt['files']):
                self.assertEqual((root / 'store' / 'fixture' / file['id']).read_bytes(), source.read_bytes())
                self.assertEqual(file['sha256'], hashlib.sha256(source.read_bytes()).hexdigest())

if __name__ == '__main__': unittest.main()
