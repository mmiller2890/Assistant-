export interface TYPE_PROVIDER {
  id?: string;
  name?: string;
  streaming?: boolean;
  streamingUrl?: string;
  responseContentPath?: string;
  isCustom?: boolean;
  platform?: string;
  curl: string;
}
