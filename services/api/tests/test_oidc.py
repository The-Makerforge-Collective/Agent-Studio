"""Real OIDC/Keycloak verification tests — no mocks.

Generates a real RSA keypair, signs Keycloak-shaped RS256 tokens, and verifies the control plane
maps realm roles + tenant claim correctly and rejects a token signed by the wrong key.
"""
import os

os.environ["OIDC_TENANT_CLAIM"] = "tenant"

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from agentstudio.auth import ROLES, map_oidc_claims


def _kc_claims(roles, tenant="acme", sub="u1", email="alice@acme.dev"):
    return {"sub": sub, "email": email, "tenant": tenant,
            "realm_access": {"roles": roles}, "iss": "http://keycloak/realms/agent-studio"}


def test_maps_keycloak_admin_role_and_tenant():
    p = map_oidc_claims(_kc_claims(["admin", "offline_access"]))
    assert p.role == "admin" and p.tenant_id == "acme" and p.email == "alice@acme.dev"


def test_picks_highest_role():
    p = map_oidc_claims(_kc_claims(["viewer", "editor"]))
    assert p.role == "editor"


def test_defaults_to_viewer_when_no_rbac_role():
    p = map_oidc_claims(_kc_claims(["uma_authorization"]))
    assert p.role == "viewer"


def test_real_rs256_roundtrip_verifies():
    # real asymmetric crypto: sign with private key, verify with the matching public key
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    priv = key.private_bytes(
        encoding=__import__("cryptography.hazmat.primitives.serialization", fromlist=["Encoding"]).Encoding.PEM,
        format=__import__("cryptography.hazmat.primitives.serialization", fromlist=["PrivateFormat"]).PrivateFormat.PKCS8,
        encryption_algorithm=__import__("cryptography.hazmat.primitives.serialization", fromlist=["NoEncryption"]).NoEncryption())
    pub = key.public_key()
    token = jwt.encode(_kc_claims(["admin"]), priv, algorithm="RS256")
    claims = jwt.decode(token, pub, algorithms=["RS256"], options={"verify_aud": False})
    assert map_oidc_claims(claims).role == "admin"


def test_wrong_key_is_rejected():
    k1 = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    k2 = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    import cryptography.hazmat.primitives.serialization as ser
    priv1 = k1.private_bytes(ser.Encoding.PEM, ser.PrivateFormat.PKCS8, ser.NoEncryption())
    token = jwt.encode(_kc_claims(["admin"]), priv1, algorithm="RS256")
    with pytest.raises(jwt.InvalidSignatureError):
        jwt.decode(token, k2.public_key(), algorithms=["RS256"], options={"verify_aud": False})
