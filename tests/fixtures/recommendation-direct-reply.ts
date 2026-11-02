/** Simulated provider data for transport tests only, never a real AI evaluation. */
export function directWireReply(input:{language?:string},choices:{id:string;reason_refs:string[];caution_ref:string|null}[]){
 return {choices:choices.map(c=>({id:c.id,explanation:input.language==='vi'?'Tôi đề xuất nhà hàng này theo yêu cầu và thông tin được cung cấp.':'Je propose ce restaurant au regard de la demande et des informations fournies.',
  caution:c.caution_ref?(input.language==='vi'?'Cần cân nhắc điểm lưu ý trong hồ sơ.':'Le point de vigilance du dossier mérite d’être considéré.'):null,uncertainties:[] as string[],source_refs:[...c.reason_refs,...(c.caution_ref?[c.caution_ref]:[])]}))};
}
