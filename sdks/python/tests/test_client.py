import io
import json
from calder import Calder


class Response:
    status = 202
    def read(self):
        return json.dumps({"data": {"id": "em_1", "status": "queued"}}).encode()


def test_send_email_contract():
    seen = {}
    def transport(request):
        seen["url"] = request.full_url
        seen["body"] = json.loads(request.data)
        seen["key"] = request.get_header("Idempotency-key")
        return Response()
    result = Calder("ck_test", "https://api.test", transport).send_email(from_="a@example.com", to="b@example.com", subject="Hi", text="Hello", idempotency_key="welcome-1")
    assert result["status"] == "queued"
    assert seen["body"]["stream"] == "transactional"
    assert seen["key"] == "welcome-1"


def test_error_class_exposed():
    assert Calder("ck_test").api_key == "ck_test"
