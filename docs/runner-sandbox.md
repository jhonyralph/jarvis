# Sandboxed runner (sharing safely)

Authentication says *who* and *which machine*; it does **not** sandbox. An agent
runs with `bypassPermissions`, so anyone you let onto a machine can make it do
anything on that machine. To share with someone you don't fully trust, give them
a **sandboxed runner** — a container/VM with nothing sensitive — instead of your
main box.

## What the sandbox contains

- A container running only the headless runner + the agent CLI.
- A `/workspace` volume as the agent's working area (isolated from host files).
- Its **own** agent credentials (a separate account / API key), not the host's.

The blast radius of a compromise or misuse is the container and `/workspace`.

## Build & run (Docker)

From the repo root:

```sh
docker build -f Dockerfile.runner -t jarvis-runner .

docker run -d --name jarvis-guest --restart unless-stopped \
  -e JARVIS_HUB="wss://<hub>/" \
  -e JARVIS_TOKEN="<token from: jarvis.ps1 machine>" \
  -e JARVIS_LABEL="Sandbox convidado" \
  -v jarvis-guest-work:/workspace \
  -v jarvis-guest-agent:/root/.claude \
  jarvis-runner
```

The machine appears in the Hub's selector like any other; grant a member access
to only this runner (per-runner allowlist).

### …or with Compose (one command)

```sh
cp .env.runner.example .env      # fill JARVIS_HUB / JARVIS_TOKEN
docker compose -f docker-compose.runner.yml up -d --build
```

Same container + volumes as above; Compose fails fast if `JARVIS_HUB` /
`JARVIS_TOKEN` are unset. `.env` is gitignored (only the `.example` is tracked).

## Agent auth inside the sandbox

The agent CLI must be installed **and authenticated** in the container, with
credentials that are NOT your host's:

1. Install the CLI in `Dockerfile.runner` (uncomment the line for your agent).
2. Authenticate once into a mounted volume so it persists:
   ```sh
   docker run -it --rm -v jarvis-guest-agent:/root/.claude jarvis-runner \
     sh -c "claude login"     # or your agent's login; follow the prompts
   ```
   Then start the container normally (it reuses that volume).
   - Or provide an API key via env at run time if your agent supports it.

## Hardening the container (optional, recommended for real guests)

- `--read-only` root FS + `--tmpfs /tmp` (keep only `/workspace` writable).
- `--cap-drop ALL --security-opt no-new-privileges`.
- CPU/memory limits (`--cpus`, `--memory`).
- No host network; reach the Hub over your private network only.
- A throwaway VM instead of a container for stronger isolation.

## Limits

- This isolates the *runner's* machine, not the Hub. The Hub still trusts an
  authenticated member on the runners you granted them.
- Not build-tested in this repo's CI; validate the image on your host.
