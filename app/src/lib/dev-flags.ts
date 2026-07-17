// TEMPORÁRIO (pedido do dono em 2026-07-17): acesso ao jogo sem login Google
// para facilitar a depuração visual do mundo procedural. O modo convidado não
// tem personagem, heartbeat nem escrita no banco — as server functions
// continuam protegidas por auth. Reverter para `false` "até segunda ordem".
export const ALLOW_GUEST_ACCESS = true;
