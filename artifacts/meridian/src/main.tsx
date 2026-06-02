import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { PhantomWalletAdapter, SolflareWalletAdapter } from "@solana/wallet-adapter-wallets";
import "./lib/api";
import App from "./App";
import "./index.css";

const wallets = [new PhantomWalletAdapter(), new SolflareWalletAdapter()];
const solanaRpcUrl = import.meta.env.VITE_SOLANA_RPC_URL?.trim() || "https://api.mainnet-beta.solana.com";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <ConnectionProvider endpoint={solanaRpcUrl}>
      <WalletProvider wallets={wallets} autoConnect={false}>
        <App />
      </WalletProvider>
    </ConnectionProvider>
  </QueryClientProvider>,
);
