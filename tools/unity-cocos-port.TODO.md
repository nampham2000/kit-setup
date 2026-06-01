Tôi viết một Creator extension rất nhỏ làm bridge cho query-config/set-config riêng phần layer, để tool ngoài app gọi vào khi Creator đang mở.

Thêm cờ CLI để ép mode convert physics, ví dụ force-3d-physics hoặc force-2d-physics cho các prefab biên.

Tôi mở rộng tiếp CapsuleCollider2D/EdgeCollider2D theo cùng cơ chế 3D-first.
Tôi thêm cờ CLI để ép chiến lược collider, ví dụ force box approximation hoặc skip polygon approximation.

Port particles system component

Tách porting tool ra thành nhiều module nhỏ ra để dễ quản lí
    Extract Unity/Cocos parser and asset DB helpers from unity-cocos-port.cjs.
    Extract prefab builder and layer-mapping logic, then remove now-redundant in-file implementations once parity stays stable.
Port shader và effect

Kiểm tra asset có sẵn trước khi import vô hoặc wire
Các module script không nên patch luôn code custom shader, mà nên tạo sẵn và chỉ thay đổi các tham số thông qua materials

SOF_Gift/Particle System node, shape modeul, Rotation, scale & rotation in Transform  issues

UIParticle_Menu, confetti_empty
MyCozyHome_Shining, Render alignment và hướng của các ray
MyCozyHome_FlowingWater bị đảo chiều oy, texture không refresh kịp
