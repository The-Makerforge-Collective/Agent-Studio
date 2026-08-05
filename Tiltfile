# Agent Studio — Tilt dev environment (kind + podman)
# Usage: tilt up

allow_k8s_contexts('kind-agent-studio')

# --- Infrastructure (no live-update needed) ---
k8s_yaml('deploy/kind/api.yaml')
k8s_yaml('deploy/kind/web.yaml')
k8s_yaml('deploy/kind/keycloak.yaml')
k8s_yaml('deploy/kind/gateway.yaml')

# --- Control Plane (FastAPI) ---
docker_build(
    'agent-studio/control-plane',
    'services/api',
    live_update=[
        sync('services/api/agentstudio', '/app/agentstudio'),
        run('pip install -q -r requirements.txt', trigger=['services/api/requirements.txt']),
    ],
)
k8s_resource('control-plane', port_forwards='8088:8080', labels=['app'])

# --- Web Console (Next.js) ---
docker_build(
    'agent-studio/web-console',
    'apps/web',
    live_update=[
        sync('apps/web/src', '/app/src'),
        sync('apps/web/public', '/app/public'),
        run('npm install', trigger=['apps/web/package.json']),
    ],
)
k8s_resource('web-console', port_forwards='3000:3000', labels=['app'])

# --- Supporting services ---
k8s_resource('postgres', labels=['infra'])
k8s_resource('keycloak', labels=['infra'])
