import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletAdapterNetwork } from "@solana/wallet-adapter-base";
import { PhantomWalletAdapter, SolflareWalletAdapter } from "@solana/wallet-adapter-wallets";
import {
  SolanaMobileWalletAdapter,
  createDefaultAddressSelector,
  createDefaultAuthorizationResultCache,
  createDefaultWalletNotFoundHandler,
} from "@solana-mobile/wallet-adapter-mobile";
import "./lib/api";
import App from "./App";
import "./index.css";

const wallets = [
  new PhantomWalletAdapter(),
  new SolflareWalletAdapter(),
  new SolanaMobileWalletAdapter({
    addressSelector: createDefaultAddressSelector(),
    appIdentity: {
      name: "Meridian",
      uri: typeof window !== "undefined" ? window.location.origin : "https://app3-production-d00b.up.railway.app",
      icon: typeof window !== "undefined" ? `${window.location.origin}/favicon.svg` : "https://app3-production-d00b.up.railway.app/favicon.svg",
    },
    authorizationResultCache: createDefaultAuthorizationResultCache(),
    cluster: WalletAdapterNetwork.Mainnet,
    onWalletNotFound: createDefaultWalletNotFoundHandler(),
  }),
];
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
        <WalletProvider wallets={wallets} autoConnect>
          <App />
        </WalletProvider>
      </ConnectionProvider>
    </QueryClientProvider>,
);
