from datetime import UTC, datetime, timedelta

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec

from app import auth
from tests.conftest import TEACHER_ID


class FakeJwks:
    """Thay PyJWKClient: trả khóa công khai cố định, không gọi mạng."""

    def __init__(self, public_key) -> None:
        self.public_key = public_key

    def get_signing_key_from_jwt(self, _token: str):
        return jwt.PyJWK.from_dict(
            jwt.algorithms.ECAlgorithm.to_jwk(self.public_key, as_dict=True) | {"alg": "ES256"}
        )


@pytest.fixture
def ec_key(monkeypatch):
    key = ec.generate_private_key(ec.SECP256R1())
    monkeypatch.setattr(auth, "_jwks_client", lambda _url: FakeJwks(key.public_key()))
    return key


def es256_header(settings, key, user_id: str) -> dict[str, str]:
    payload = {
        "sub": user_id,
        "aud": settings.supabase_jwt_audience,
        "exp": datetime.now(UTC) + timedelta(hours=1),
    }
    return {"Authorization": f"Bearer {jwt.encode(payload, key, algorithm='ES256')}"}


def test_es256_token_from_jwks_is_accepted(client, settings, ec_key):
    resp = client.get("/api/me", headers=es256_header(settings, ec_key, TEACHER_ID))
    assert resp.status_code == 200
    assert resp.json()["role"] == "teacher"


def test_es256_token_signed_with_unknown_key_is_rejected(client, settings, ec_key):
    stranger = ec.generate_private_key(ec.SECP256R1())
    resp = client.get("/api/me", headers=es256_header(settings, stranger, TEACHER_ID))
    assert resp.status_code == 401


def test_hs256_token_rejected_when_no_secret_configured(client, settings):
    from tests.conftest import auth_header

    headers = auth_header(settings, TEACHER_ID)
    settings.supabase_jwt_secret = ""
    assert client.get("/api/me", headers=headers).status_code == 401
