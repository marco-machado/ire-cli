export interface Reader {
  get(url: string, init?: Omit<RequestInit, "method">): Promise<Response>;
}

export const fetchReader: Reader = {
  get(url, init) {
    return fetch(url, { ...init, method: "GET" });
  },
};
