{
  description = "dsh-webui-framework：dsh Web 前端整页 UI 插件的开发与 CI 工具链（Node + npm + pnpm）";

  inputs.nixpkgs.url = "git+https://mirrors.tuna.tsinghua.edu.cn/git/nixpkgs.git?ref=nixos-unstable&shallow=1";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "aarch64-darwin" ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems
        (system: f nixpkgs.legacyPackages.${system});

      version = "24.21.0";

      # Official nodejs.org build: node-addon-require-builtin matches its codegen.
      tarballs = {
        x86_64-linux = {
          file = "linux-x64";
          hash = "sha256-/Y5Z1aURUQ9qKYr7VI8Yx9KxvkBNi0on2U++SfVsstY=";
        };
        aarch64-linux = {
          file = "linux-arm64";
          hash = "sha256-atEyXtvbVknDebdaI3FHpmbJXU+a6NNA/vLRV10omtI=";
        };
        aarch64-darwin = {
          file = "darwin-arm64";
          hash = "sha256-YjnUz5LYZEh+yM02FQOPe2fn9Yt3shzS8J6p+9aAZf4=";
        };
      };

      mkNode = pkgs:
        let
          inherit (pkgs.stdenv.hostPlatform) system isLinux;
          tarball = tarballs.${system};
        in
        pkgs.stdenvNoCC.mkDerivation {
          pname = "nodejs-official";
          inherit version;

          src = pkgs.fetchurl {
            url = "https://nodejs.org/dist/v${version}/node-v${version}-${tarball.file}.tar.xz";
            inherit (tarball) hash;
          };

          nativeBuildInputs = [ pkgs.makeBinaryWrapper ]
            ++ pkgs.lib.optional isLinux pkgs.patchelf;

          dontBuild = true;
          dontStrip = true;
          dontPatchELF = true;
          dontPatchShebangs = true;

          installPhase = ''
            mkdir -p $out
            cp -a . $out/
          '' + pkgs.lib.optionalString isLinux ''
            # Interpreter only: rewriting RPATH makes node segfault.
            patchelf --set-interpreter ${pkgs.stdenv.cc.bintools.dynamicLinker} $out/bin/node
            wrapProgram $out/bin/node --prefix LD_LIBRARY_PATH : ${pkgs.lib.getLib pkgs.stdenv.cc.cc}/lib
          '';

          meta.mainProgram = "node";
        };
    in
    {
      packages = forAllSystems (pkgs: {
        nodejs-official = mkNode pkgs;
        default = mkNode pkgs;
      });

      devShells = forAllSystems (pkgs: {
        default = pkgs.mkShell {
          packages = [ self.packages.${pkgs.stdenv.hostPlatform.system}.nodejs-official pkgs.git pkgs.pnpm ];

          shellHook = ''
            echo "node: $(node --version)  npm: $(npm --version)"
          '';
        };
      });
    };
}
