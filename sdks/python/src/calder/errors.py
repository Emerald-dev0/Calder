from typing import Optional


class CalderError(Exception):
    def __init__(self, message: str, status: Optional[int] = None, code: Optional[str] = None, request_id: Optional[str] = None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.request_id = request_id


class CalderApiError(CalderError):
    pass
