import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { PhantomWalletAdapter, SolflareWalletAdapter } from "@solana/wallet-adapter-wallets";
import {
  createDefaultAuthorizationCache,
  createDefaultChainSelector,
  createDefaultWalletNotFoundHandler,
  registerMwa,
} from "@solana-mobile/wallet-standard-mobile";
import "./lib/api";
import App from "./App";
import "./index.css";

const wallets = [new PhantomWalletAdapter(), new SolflareWalletAdapter()];
const solanaRpcUrl = import.meta.env.VITE_SOLANA_RPC_URL?.trim() || "https://api.mainnet-beta.solana.com";

if (typeof window !== "undefined") {
  registerMwa({
    appIdentity: {
      name: "Meridian",
      uri: window.location.origin,
      icon: `${window.location.origin}/favicon.svg`,
    },
    authorizationCache: createDefaultAuthorizationCache(),
    chains: ["solana:mainnet"],
    chainSelector: createDefaultChainSelector(),
    onWalletNotFound: createDefaultWalletNotFoundHandler(),
  });
}

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
