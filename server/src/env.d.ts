// Secrets are not part of wrangler.toml, so they are not in the generated Env type.
interface Env {
  ADMIN_KEY?: string;
}
