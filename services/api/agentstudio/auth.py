"""Authentication + RBAC (FR-12.5: scope-aware RBAC, tenant isolation).

Real, not stubbed: PBKDF2 password hashing (stdlib), signed JWTs (HS256), a FastAPI dependency
that resolves the caller to a (user, tenant, role) principal, and role ordering for RBAC.

This is the identity model an OIDC/SSO provider (Keycloak, per the PRD) plugs into: SSO would
mint the same JWT claims (sub, tenant, role). Password login is the built-in path for now.
"""
from __future__ import annotations

import hashlib
import hmac
import os
import time

import jwt
from fastapi import Depends, Header, HTTPException
from pydantic import BaseModel

JWT_SECRET = os.environ.get("JWT_SECRET", "dev-insecure-secret-change-me")
JWT_TTL_SECONDS = int(os.environ.get("JWT_TTL_SECONDS", "3600"))

# OIDC / Keycloak (dual-issuer, FR-12.5). When OIDC_JWKS_URL is set, Keycloak RS256 tokens are the
# primary auth path; the local HS256 password login remains a dev fallback.
OIDC_JWKS_URL = os.environ.get("OIDC_JWKS_URL", "")
OIDC_ISSUER = os.environ.get("OIDC_ISSUER", "")
OIDC_TENANT_CLAIM = os.environ.get("OIDC_TENANT_CLAIM", "tenant")

# RBAC roles, least→most privileged
ROLES = ["viewer", "editor", "admin"]


def _rank(role: str) -> int:
    return ROLES.index(role) if role in ROLES else -1


def hash_password(password: str, salt: str | None = None) -> str:
    salt = salt or os.urandom(16).hex()
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 200_000)
    return f"{salt}${dk.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        salt, _ = stored.split("$", 1)
    except ValueError:
        return False
    return hmac.compare_digest(hash_password(password, salt), stored)


def create_token(user_id: str, tenant_id: str, role: str, email: str) -> str:
    now = int(time.time())
    return jwt.encode(
        {"sub": user_id, "tenant": tenant_id, "role": role, "email": email,
         "iat": now, "exp": now + JWT_TTL_SECONDS},
        JWT_SECRET, algorithm="HS256")


class Principal(BaseModel):
    user_id: str
    tenant_id: str
    role: str
    email: str


def map_oidc_claims(claims: dict) -> Principal:
    """Map Keycloak token claims → our principal. Pure (unit-testable)."""
    tenant = claims.get(OIDC_TENANT_CLAIM) or claims.get("tenant") or ""
    realm_roles = (claims.get("realm_access") or {}).get("roles", [])
    role = "viewer"
    for r in ROLES:                              # pick the highest RBAC role present
        if r in realm_roles:
            role = r
    return Principal(user_id=claims.get("sub", ""), tenant_id=tenant,
                     role=role, email=claims.get("email", claims.get("preferred_username", "")))


_jwk_client = None


def _verify_oidc(token: str) -> Principal:
    global _jwk_client
    if _jwk_client is None:
        from jwt import PyJWKClient
        _jwk_client = PyJWKClient(OIDC_JWKS_URL)
    key = _jwk_client.get_signing_key_from_jwt(token).key
    claims = jwt.decode(token, key, algorithms=["RS256"],
                        issuer=OIDC_ISSUER or None,
                        options={"verify_aud": False, "verify_iss": bool(OIDC_ISSUER)})
    return map_oidc_claims(claims)


def _verify_local(token: str) -> Principal:
    claims = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    return Principal(user_id=claims["sub"], tenant_id=claims["tenant"],
                     role=claims["role"], email=claims["email"])


def get_principal(authorization: str | None = Header(default=None)) -> Principal:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "missing bearer token")
    token = authorization.split(" ", 1)[1].strip()
    # dual-issuer: try Keycloak/OIDC first (if configured), then local HS256
    errors = []
    if OIDC_JWKS_URL:
        try:
            return _verify_oidc(token)
        except Exception as e:  # noqa: BLE001 — fall through to local issuer
            errors.append(f"oidc: {e}")
    try:
        return _verify_local(token)
    except jwt.PyJWTError as e:
        errors.append(f"local: {e}")
    raise HTTPException(401, f"invalid token ({'; '.join(errors)})")


def require_role(minimum: str):
    """Dependency factory: 403 unless the caller's role >= minimum."""
    def _dep(principal: Principal = Depends(get_principal)) -> Principal:
        if _rank(principal.role) < _rank(minimum):
            raise HTTPException(403, f"role '{principal.role}' insufficient; need '{minimum}'")
        return principal
    return _dep
