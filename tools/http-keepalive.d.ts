export declare const httpAgent: any;
export declare const httpsAgent: any;
export declare function fetchKA(url: string, opts?: any): Promise<Response>;
export declare function getKAStats(): { http: { sockets: number; free: number; requests: number; }; https: { sockets: number; free: number; requests: number; } };
