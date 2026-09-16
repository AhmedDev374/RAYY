 import io

p = "src/components/control/ControlCenter.interaction.test.tsx"
lines = io.open(p, encoding="utf-8").read().split("\n")
for i, line in enumerate(lines):
    if "new QueryClient({ defaultOptions" in line:
        good = (
            "    const client = new QueryClient({ defaultOptions: { queries: { retry: false }"
            "}"
            "});"
        )
        assert good.count("{") == good.count("}"), good
        lines[i] = good
        print("fixed line", i + 1)
io.open(p, "w", encoding="utf-8").write("\n".join(lines))
print("OK")
