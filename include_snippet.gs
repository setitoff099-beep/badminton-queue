// เพิ่มฟังก์ชันนี้ใน Code.gs (ถ้ายังไม่มี) เพื่อให้ <?!= include('...'); ?> ทำงาน
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

// สำคัญ: doGet ต้องใช้ createTemplateFromFile(...).evaluate() (ไม่ใช่ createHtmlOutputFromFile)
// ตัวอย่าง:
// function doGet() {
//   return HtmlService.createTemplateFromFile('index').evaluate()
//     .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
// }
