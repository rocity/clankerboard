# Self-hosted, single deployable

Clankerboard ships as one self-hosted deployment per organisation (`docker compose up`: one app container plus Postgres), not as a hosted SaaS. The data model still scopes everything by Company so multi-tenancy, and a hosted offering, stay possible later without a schema rewrite. Self-hosting rules out serverless runtimes: the app is a long-running Node process, which is what makes SSE and the MCP endpoint simple.
