use crate::inbox::{
    self, InboxAssignRequest, InboxItem, InboxItemInput, InboxItemPatch, InboxState,
};

#[tauri::command]
pub fn inbox_list(state: tauri::State<'_, InboxState>) -> Result<Vec<InboxItem>, String> {
    let conn = state.conn.lock().unwrap();
    inbox::list_impl(&conn)
}

#[tauri::command]
pub fn inbox_add(
    input: InboxItemInput,
    state: tauri::State<'_, InboxState>,
) -> Result<InboxItem, String> {
    let conn = state.conn.lock().unwrap();
    inbox::add_impl(&conn, &input)
}

#[tauri::command]
pub fn inbox_update(
    id: String,
    patch: InboxItemPatch,
    state: tauri::State<'_, InboxState>,
) -> Result<InboxItem, String> {
    let conn = state.conn.lock().unwrap();
    inbox::update_impl(&conn, &id, &patch)
}

#[tauri::command]
pub fn inbox_dismiss(id: String, state: tauri::State<'_, InboxState>) -> Result<(), String> {
    let conn = state.conn.lock().unwrap();
    inbox::dismiss_impl(&conn, &id)
}

#[tauri::command]
pub fn inbox_assign(
    request: InboxAssignRequest,
    state: tauri::State<'_, InboxState>,
) -> Result<InboxItem, String> {
    let conn = state.conn.lock().unwrap();
    inbox::assign_impl(&conn, &request)
}

#[tauri::command]
pub fn inbox_unassign(
    id: String,
    state: tauri::State<'_, InboxState>,
) -> Result<InboxItem, String> {
    let conn = state.conn.lock().unwrap();
    inbox::unassign_impl(&conn, &id)
}

#[tauri::command]
pub fn inbox_attach(
    item_id: String,
    source_path: String,
    state: tauri::State<'_, InboxState>,
) -> Result<InboxItem, String> {
    let conn = state.conn.lock().unwrap();
    inbox::attach_impl(
        &conn,
        &state.attachments_dir,
        &item_id,
        std::path::Path::new(&source_path),
    )
}

#[tauri::command]
pub fn inbox_attach_text(
    item_id: String,
    file_name: String,
    body: String,
    state: tauri::State<'_, InboxState>,
) -> Result<InboxItem, String> {
    let conn = state.conn.lock().unwrap();
    inbox::attach_text_impl(&conn, &state.attachments_dir, &item_id, &file_name, &body)
}

#[tauri::command]
pub fn inbox_detach(
    item_id: String,
    attachment_id: String,
    state: tauri::State<'_, InboxState>,
) -> Result<InboxItem, String> {
    let conn = state.conn.lock().unwrap();
    inbox::detach_impl(&conn, &item_id, &attachment_id)
}

#[tauri::command]
pub fn inbox_set_ticket_status(
    project_path: String,
    ticket_id: String,
    status: String,
) -> Result<(), String> {
    inbox::set_ticket_status_impl(&project_path, &ticket_id, &status)
}
