// Global window type extensions for pflow-reflect plugin
type FilterFn = (content: string) => string;

declare global {
    interface Window {
        promptFlow?: {
            filters?: Record<string, FilterFn>;
        };
    }
}

export type { FilterFn };
