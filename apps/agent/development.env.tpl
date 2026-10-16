SERVER_URL=http://localhost:3000

# The node the test migrations seed. The instanced scripts swap in a key of the instance's own.
NODE_KEY=dc9f2a26-2f30-4a1e-9f2c-9c1f0b5c7a10
NODE_SECRET=mfn_dev-node-secret-not-a-real-secret

LOG_LEVEL=debug

# A local device reader build, from `cargo build --manifest-path crates/Cargo.toml`.
# GPU_READER_PATH=../../crates/target/debug/mf-gpu

# Model directories to scan, relative to apps/agent. Set, it replaces the instance's empty .workdir/models.
# MODEL_DIRS=../../_localdev/models
