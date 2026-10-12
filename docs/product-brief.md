# SAYSTRIKE — PRODUCT BRIEF v1.0

## 1. Product vision

SayStrike là một web game luyện nói tiếng Anh, biến mỗi lần luyện nói thành một trận chiến arcade. Người chơi đọc câu tiếng Anh được giao, ghi âm giọng nói, nhận đánh giá có căn cứ và dùng kết quả đó để tấn công boss. Độ khó thay đổi theo hiệu suất luyện tập thực tế.

Sản phẩm ưu tiên trải nghiệm smartphone: mở web, bắt đầu luyện nói nhanh, giao diện dễ thao tác bằng một tay, microphone rõ ràng, phản hồi nhanh và gameplay có động lực nhưng không trừng phạt người học khi hệ thống gặp lỗi.

## 2. Product principles

- Mobile-first, responsive, dùng tốt trên smartphone hiện đại và desktop.
- Voice-first: giọng nói của người học luôn quan trọng hơn nhạc nền và hiệu ứng.
- Evidence-based feedback: không bịa transcript, lỗi phát âm, điểm số hoặc nhận xét khi audio không đủ rõ.
- Backend-authoritative game state: model AI không tự quyết định HP, energy, damage, XP hoặc thắng/thua.
- Fair gameplay: audio lỗi, thiếu bằng chứng hoặc confidence thấp không được tính là thất bại của người chơi.
- Practice-oriented: người chơi có thể bỏ qua retry, không bị ép luyện lại cùng một câu.
- Maintainable implementation: ưu tiên tái sử dụng code và kiến trúc trong repository hiện có.

## 3. Core product flow

1. Người chơi vào trang chính và chọn Practice hoặc Boss Battle.
2. Hệ thống chọn câu mục tiêu dựa trên trình độ, mục tiêu học và lịch sử hợp lệ.
3. Người chơi xem câu mục tiêu và ghi âm.
4. Hệ thống đánh giá audio và trả kết quả có cấu trúc.
5. Backend xác thực kết quả, tính điểm và cập nhật game state.
6. Người chơi nhận feedback, xem HP/energy thay đổi và chọn tiếp tục, retry hoặc kết thúc.
7. Hệ thống lưu các lượt hợp lệ để điều chỉnh độ khó và tổng kết phiên.

## 4. Speech evaluation

Điểm Speaking Score ban đầu là thang 100, gồm:

- Content accuracy / match to target: 40 điểm.
- Clarity / intelligibility: 35 điểm.
- Fluency: 25 điểm.

Đây là trọng số khởi đầu cho MVP, chưa phải thang đo năng lực ngôn ngữ được kiểm định. Không xem giọng vùng miền hoặc accent khác biệt là lỗi tự động. Không khẳng định hệ thống chấm chính xác từng phoneme nếu chưa có bằng chứng kỹ thuật.

Mỗi lượt đánh giá cần có trạng thái rõ ràng:
- valid: đủ bằng chứng để chấm.
- insufficient_evidence: không đủ bằng chứng.
- audio_error: lỗi ghi âm, truyền tải hoặc xử lý.
- evaluation_error: lỗi dịch vụ đánh giá hoặc output không hợp lệ.

Lượt không hợp lệ không được gây damage, trừ energy hoặc được tính là một thất bại của người chơi.

Backend phải kiểm tra schema, giới hạn điểm, tổng điểm, confidence, trạng thái và evidence trước khi áp dụng gameplay.

## 5. Adaptive difficulty

Lưu các lượt đánh giá hợp lệ. Nếu có dưới 10 lượt hoàn thành hợp lệ, dùng tối đa 3 lượt gần nhất để điều chỉnh; từ 10 lượt trở lên, dùng tối đa 5 lượt gần nhất.

Quy tắc khởi đầu:
- Điểm trung bình từ 85 trở lên và ít nhất 2/3 lượt gần nhất đạt ngưỡng; nếu cửa sổ có 5 lượt thì ít nhất 4/5 lượt đạt ngưỡng: tăng độ khó một bậc.
- Điểm trung bình từ 65 đến dưới 85: giữ nguyên.
- Điểm trung bình dưới 65: giảm độ khó một bậc.
- Thiếu lượt hợp lệ hoặc confidence không đủ: giữ nguyên độ khó và thu thập thêm dữ liệu.

Chỉ thay đổi một hoặc hai chiều độ khó mỗi lần: độ dài câu, độ phức tạp cú pháp, mệnh đề, từ vựng hoặc thử thách độ trôi chảy. Đặt giới hạn difficulty rõ ràng; không để AI tự ý thay đổi state.

## 6. Boss Battle

MVP chỉ cần một boss:
- Boss HP: 100.
- Người chơi energy: 3.
- Ba phase theo lượng HP boss còn lại:
  - Phase 1: 100–61 HP.
  - Phase 2: 60–31 HP.
  - Phase 3: 30–0 HP.

Boss phase quyết định bối cảnh và mức thử thách; adaptive difficulty vẫn kiểm soát độ khó câu, có giới hạn phù hợp với battle.

Damage cơ bản:
damage = round(30 × SpeakingScore / 100).

Ngưỡng hành động ban đầu:
- Score 80–100: strong hit, không mất energy.
- Score 65–79: normal hit, không mất energy.
- Score 40–64: weak hit, damage thấp và mất 1 energy.
- Score 1–39: critical failure, damage rất thấp, mất 1 energy và nhận Broken Rhythm.
- Score 0: complete miss, không gây damage, mất 1 energy và nhận Guard Break.

Các mức damage, ngưỡng và debuff cần được triển khai bằng logic xác định trong backend và có thể tinh chỉnh sau playtest. Quy tắc damage cụ thể cho các tier thấp phải được ghi thành cấu hình rõ ràng, không để model quyết định.

Broken Rhythm: vô hiệu hóa combo damage bonus ở lượt kế tiếp; xóa khi người chơi đạt score từ 65 trở lên.

Guard Break: mất bảo vệ ở lượt kế tiếp; nếu tiếp tục thất bại, trận đấu có thể kết thúc theo luật backend.

Audio lỗi, thiếu bằng chứng hoặc confidence thấp: không damage, không mất energy, không debuff.

Retry cùng một câu là lượt luyện tập, không phải đòn tấn công mới; không được áp dụng penalty hoặc damage hai lần cho cùng một lượt.

Energy về 0 thì kết thúc battle, hiển thị review và cho phép luyện tập rồi thử lại.

Battle flow: challenge → recording → evaluation → validate → apply damage → boss response → next turn hoặc kết thúc.

Backend là nguồn sự thật duy nhất của HP, energy, phase, damage, debuff, XP và kết quả battle.

## 7. Review and progression

Instant Review:
- Tổng điểm và ba điểm thành phần.
- Một điểm mạnh cụ thể.
- Một vấn đề ưu tiên.
- Một lời khuyên hành động được ngay.
- Nút retry, next challenge hoặc exit.

Session Review sau khoảng 5–10 lượt:
- Xu hướng điểm số.
- Kỹ năng tốt nhất.
- Vấn đề lặp lại.
- Mục tiêu luyện tập tiếp theo.

Boss Battle Review:
- Victory hoặc defeat.
- Số đòn tấn công hợp lệ.
- Điểm trung bình và cao nhất.
- Kỹ năng tiến bộ nhất.
- Điểm yếu cần luyện.
- XP và đề xuất trận tiếp theo.

XP tách biệt với Speaking Score. XP khởi đầu: +20 cho challenge hợp lệ hoàn thành; +5 khi điểm từ 80; +5 khi retry cải thiện ít nhất 5 điểm nếu hai kết quả so sánh được; +10 khi hoàn thành mục tiêu phiên. Chống farm XP và không tính lượt lỗi.

## 8. Sound and music

Phong cách: dark synthwave × neon arcade battle, hiện đại, nhịp điện tử, tím neon và cyan.

Music states:
- Main menu: ambient synthwave, 85–100 BPM.
- Practice: electronic tập trung, 90–110 BPM.
- Boss Battle: synthwave battle, 115–135 BPM.
- Victory sting: 3–7 giây.
- Defeat sting: 2–5 giây.

Boss music có thể tăng lớp nhạc theo ba phase. Khi người chơi bắt đầu nói, giảm nhạc nền khoảng 12–18 dB; sau khi ghi âm xong, khôi phục dần. Dùng crossfade khi chuyển nhạc. Không phát nhạc lớn tự động. Tách điều chỉnh Music, SFX và Voice.

## 9. Visual direction

Dark synthwave, neon purple/cyan, tương phản cao, typography dễ đọc, hiệu ứng có mục đích. Không hy sinh readability để trang trí. Các trạng thái chính phải phân biệt được bằng chữ, biểu tượng và màu, không chỉ dựa vào màu.

Hiệu ứng ưu tiên:
- Voice Capture: waveform, mic state, timer, processing.
- Hit Impact: damage number, boss hit reaction, HP decrease.
- Critical Failure: cue đỏ ngắn, boss counterattack, energy giảm.
- Victory/Defeat: animation kết thúc và review.

Tôn trọng prefers-reduced-motion. Không để animation chặn microphone, retry, next hoặc exit.

## 10. MVP acceptance criteria

- Người dùng có thể mở web trên smartphone và hoàn thành một lượt luyện nói.
- Xin quyền microphone đúng lúc và xử lý permission denied.
- Có trạng thái recording, processing, valid result và error.
- Không chấm điểm giả hoặc trừ energy khi audio/evaluation lỗi.
- Speaking Score và các điểm thành phần được kiểm tra ở backend.
- Adaptive difficulty sử dụng lịch sử hợp lệ.
- Boss Battle cập nhật HP/energy theo đúng luật backend.
- Retry không tính thành một đòn mới.
- Music ducking hoạt động khi ghi âm.
- Layout không tràn ngang ở viewport smartphone.
- Có loading, empty, error và retry states.
- Có test cho scoring validation, difficulty controller, damage, energy, debuff và battle termination.
- Có hướng dẫn cấu hình API key, chạy local, test và build production.

Mọi con số và quy tắc ở trên là cấu hình MVP ban đầu, cần được kiểm thử với người dùng thật trước khi tuyên bố là thang đo khoa học.
