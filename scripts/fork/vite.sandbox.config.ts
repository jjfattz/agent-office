// Vite for scripts/fork/sandbox.sh: the project's own config, with the dev server on the sandbox's
// port and everything it proxies to :4600 (where the working office listens) sent to the sandbox's
// server instead.
import base from '../../vite.config.ts';

const server = Number(process.env.AGENT_OFFICE_SANDBOX_PORT) || 4610;
const vite = Number(process.env.AGENT_OFFICE_SANDBOX_VITE_PORT) || 5183;
const retarget = (target: unknown) => String(target).replace(/:4600\b/, `:${server}`);

const proxy = Object.fromEntries(
  Object.entries(base.server?.proxy ?? {}).map(([path, to]) => [path, typeof to === 'string' ? retarget(to) : { ...to, target: retarget(to.target) }]),
);

export default { ...base, server: { ...base.server, port: vite, strictPort: true, proxy } };
