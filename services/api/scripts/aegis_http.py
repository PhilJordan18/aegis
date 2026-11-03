"""HTTP client shared by the demo scripts, standard library only.

Environment:
  AEGIS_API_URL  default http://127.0.0.1:8080/api/v1
"""

import json
import os
import urllib.error
import urllib.request

API = os.environ.get("AEGIS_API_URL", "http://127.0.0.1:8080/api/v1").rstrip("/")


def send(method, path, token=None, body=None, key=None):
    """Return (status, payload) for any HTTP answer; only a transport failure raises."""
    request = urllib.request.Request(API + path, method=method)
    request.add_header("Accept", "application/json")
    if token:
        request.add_header("Authorization", "Bearer " + token)
    if key:
        request.add_header("Idempotency-Key", key)
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        request.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(request, data, timeout=10) as response:
            raw = response.read()
            return response.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as error:
        raw = error.read()
        try:
            return error.code, json.loads(raw) if raw else {}
        except ValueError:
            return error.code, {}
