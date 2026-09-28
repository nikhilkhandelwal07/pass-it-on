# Builds phone-demo.html with pass-it-on.html embedded, so it has no file dependency.
import re, sys
app = open(sys.argv[1], encoding="utf8").read()
assert "<!--" not in app, "HTML comments would break the embedding"
embedded = re.sub(r"</script", r"<\/script", app, flags=re.I)
tpl = open(sys.argv[2], encoding="utf8").read()
open(sys.argv[3], "w", encoding="utf8").write(tpl.replace("/*@@APP@@*/", embedded))
