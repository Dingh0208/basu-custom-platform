from docx import Document
from docx.oxml.ns import qn

DOCX = r"D:\code\Basu-Custom-Platform\docs\PRD-客户信息聚合工作台-v1.0.docx"


def main():
    doc = Document(DOCX)
    paras = doc.paragraphs
    heading_idx = next(i for i, p in enumerate(paras) if p.style.name == "TOC Heading" and p.text.strip() == "目录")
    first_toc_idx = next(i for i, p in enumerate(paras) if p.style.name.lower() == "toc 2")
    removed = []
    for i in range(first_toc_idx - 1, heading_idx, -1):
        para = paras[i]
        brs = para._p.findall(".//" + qn("w:br"))
        if any(b.get(qn("w:type")) == "page" for b in brs):
            doc.element.body.remove(para._element)
            removed.append(i)
    doc.save(DOCX)
    print("removed page-break paragraphs:", removed)


if __name__ == "__main__":
    main()
