# Acesso pelo Android

O aplicativo Android é um cliente do Centro de Custos instalado no Windows. O banco continua protegido na instalação principal e o celular usa a mesma autenticação do sistema.

## Na mesma rede Wi-Fi

1. Instale e abra a versão RC10 no computador.
2. Entre como administrador e abra **Configurações > Acesso pelo celular**.
3. Ative **Permitir acesso na rede local** e aguarde a reinicialização.
4. Anote o endereço exibido, por exemplo `http://192.168.1.10:3333`.
5. Instale o APK no Android, informe esse endereço e toque em **Conectar**.

O computador precisa permanecer ligado e conectado à mesma rede. Use esse modo somente em uma rede confiável.

## Fora da empresa

Use um endereço HTTPS protegido que encaminhe para a instalação Windows. O aplicativo rejeita endereços HTTP públicos; não exponha diretamente a porta 3333 na internet.
