# Docker Swarm Deployment & Troubleshooting

Este documento descreve o processo de deploy utilizando Docker Swarm e as correções aplicadas para resolver problemas de conectividade (Infinite Loading).

## Problemas Identificados

Ao utilizar `docker stack deploy`, os containers subiam corretamente (`Running`), mas os serviços ficavam inacessíveis via browser (Loading infinito). Isso ocorre frequentemente em ambientes locais ou virtualizados (como WSL2) devido a falhas na **Ingress Routing Mesh** do Swarm.

## Soluções Aplicadas

### 1. Bypass do Ingress Mesh (`mode: host`)

Para evitar o overhead e as falhas de roteamento VIP (Virtual IP) do Swarm em ambiente de desenvolvimento, alteramos a publicação das portas para o modo `host`.

```yaml
ports:
  - target: 5173
    published: 5173
    mode: host
```

**Nota:** Este modo vincula a porta do container diretamente à porta do nó, ignorando o balanceamento de carga do Ingress Mesh.

### 2. Ajuste de Réplicas

Como o modo `host` vincula uma porta física do nó ao container, não é possível ter mais de uma réplica do mesmo serviço na mesma porta em um único nó. Por isso, ajustamos as réplicas para `1` para os serviços que expõem portas.

### 3. Otimização de MTU

Adicionamos a configuração de MTU na rede overlay para evitar fragmentação de pacotes, o que também pode causar travamentos em conexões TCP.

```yaml
networks:
  pixpro-net:
    driver: overlay
    driver_opts:
      com.docker.network.driver.mtu: 1400
```

## Como Fazer o Deploy

1. Garanta que o Swarm está inicializado:
   ```bash
   docker swarm init
   ```

2. Remova stacks antigas (se houver):
   ```bash
   docker stack rm pixpro
   ```

3. Suba a nova stack:
   ```bash
   docker stack deploy -c docker-stack.yml pixpro
   ```

## Monitoramento

Para verificar a saúde dos serviços:
```bash
docker stack services pixpro
docker stack ps pixpro
```

Para ver logs de um serviço específico:
```bash
docker service logs pixpro_front -f
```
