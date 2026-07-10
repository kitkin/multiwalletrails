// Demo server: boots the in-process devnet + sweep engine and serves a small
// Russian control panel with working buttons (Пополнить газ / Сметание).
import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';
import * as engine from './engine.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8001); // browser-safe

// Mainnet gas — to translate the demo's measured gas into a real-world $ cost.
const gasClient = createPublicClient({ transport: http(process.env.GAS_RPC || 'https://ethereum-rpc.publicnode.com') });
async function mainnetGwei() {
  try { return Number(await gasClient.getGasPrice()) / 1e9; } catch { return null; }
}

const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, 'public')));

app.get('/api/state', async (_req, res) => {
  const s = await engine.getState();
  s.mainnetGwei = await mainnetGwei();
  res.json(s);
});
app.post('/api/topup', async (_req, res) => { try { res.json(await engine.topUpGas()); } catch (e) { res.status(500).json({ error: String(e.message) }); } });
app.post('/api/sweep', async (_req, res) => { try { res.json(await engine.sweep()); } catch (e) { res.status(500).json({ error: String(e.message) }); } });
app.post('/api/reseed', async (_req, res) => { try { res.json(await engine.reseed()); } catch (e) { res.status(500).json({ error: String(e.message) }); } });

console.log('Booting devnet + deploying MockUSDT…');
await engine.init();
console.log('Demo ready.');
app.listen(PORT, () => console.log(`Demo panel on http://localhost:${PORT}`));
