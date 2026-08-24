# Acesso pelo Android

O aplicativo Android é um cliente do Centro de Custos instalado no Windows. O banco continua protegido na instalação principal e o celular usa a mesma autenticação do sistema.

## Versão mobile em HTTPS

1. Instale e abra a versão mais recente no computador.
2. Entre como administrador e abra **Configurações > Acesso pelo celular**.
3. No celular, abra a câmera e escaneie o QR Code exibido.
4. O navegador abrirá diretamente a versão mobile segura em HTTPS.
5. Entre normalmente na tela de login.

O QR Code abre `https://centro-custos-api.construtec-reports.workers.dev` e não depende da rede Wi-Fi do computador.

## Cliente conectado à instalação Windows

Para conectar o APK Android diretamente ao aplicativo deste computador:

1. Conecte o computador e o celular à mesma rede Wi-Fi.
2. Ative **Permitir acesso na rede local**, aceite a confirmação do Firewall do Windows e aguarde a reinicialização.
3. No APK Android, informe o endereço local exibido nas configurações.

Nesse modo local, o computador precisa permanecer ligado e conectado à mesma rede. Use somente uma rede confiável.

## Fora da empresa

Use um endereço HTTPS protegido que encaminhe para a instalação Windows. O aplicativo rejeita endereços HTTP públicos; não exponha diretamente a porta 3333 na internet.
