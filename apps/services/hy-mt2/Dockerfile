FROM ghcr.io/ggml-org/llama.cpp:server-b10524@sha256:d88f41f7675f8b30d7213a917f72a48f05d0549af4d1be7e712ebb130a235415

COPY apps/services/hy-mt2/start-model.sh /usr/local/bin/start-verified-model
RUN chmod 0555 /usr/local/bin/start-verified-model

ENTRYPOINT ["/usr/local/bin/start-verified-model"]
