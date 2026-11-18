// Partida da worker do índice de busca, em JS puro: uma worker NÃO herda o loader do tsx do processo
// principal (o `--import tsx` não vale dentro dela — "Unknown file extension .ts"). Registra o tsx
// aqui dentro e só então carrega o código de verdade, que é TypeScript como o resto do Jarvis.
import { register } from "tsx/esm/api";

register();
await import("./session-index-worker.ts");
