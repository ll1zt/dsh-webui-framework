{
  description = "dsh-webui-framework：dsh Web 前端整页 UI 插件的开发与 CI 工具链（Node + npm）";

  inputs.nixpkgs.url = "git+https://mirrors.tuna.tsinghua.edu.cn/git/nixpkgs.git?ref=nixos-unstable&shallow=1";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "aarch64-darwin" ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems
        (system: f nixpkgs.legacyPackages.${system});
    in {
      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          # Node 24 直接运行 .ts 脚本（scripts/*.ts 依赖类型剥离）；npm 随 Node 提供。
          packages = [ pkgs.nodejs_24 pkgs.git ];

          shellHook = ''
            echo "node: $(node --version)  npm: $(npm --version)"
          '';
        };
      });
    };
}
