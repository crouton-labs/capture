/** Capture addresses CDP endpoints on one literal loopback address, never the
 * hostname `localhost`: the hostname can resolve to either address family,
 * which makes two listeners sharing a port an ambiguous endpoint. */
export const CDP_LOOPBACK_HOST = '127.0.0.1';
