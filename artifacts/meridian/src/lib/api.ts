import { setBaseUrl } from "@workspace/api-client-react";

const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim() ?? "";

setBaseUrl(configuredBaseUrl.length > 0 ? configuredBaseUrl : null);

export const API_BASE_URL = configuredBaseUrl;
