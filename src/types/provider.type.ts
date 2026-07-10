export interface TYPE_PROVIDER {
  id?: string;
  streaming?: boolean;
  streamingUrl?: string;
  responseContentPath?: string;
  isCustom?: boolean;
  curl: string;
}
